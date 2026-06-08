const { google } = require('googleapis');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = 'Review Queue';

let sheetsClient = null;

function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    col--;
    letter = String.fromCharCode(65 + (col % 26)) + letter;
    col = Math.floor(col / 26);
  }
  return letter;
}

function getAuth() {
  if (sheetsClient) return sheetsClient;

  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const credsPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

  let credentials;
  if (credsJson) {
    credentials = JSON.parse(credsJson);
  } else if (credsPath) {
    credentials = require(path.resolve(credsPath));
  } else {
    return null;
  }

  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function getStatusEmoji(status) {
  const map = {
    in_review: '🔄 In Progress',
    fix_needed: '🔧 Fix Needed',
    fix_made: '🔄 Re-review',
    escalated: '🔴 Escalated',
    approved: '✅ Approved',
    rejected: '❌ Rejected',
    deleted: '🗑️ Deleted',
    pending: '⏳ Pending'
  };
  return map[status] || status;
}

const CANONICAL_VALUES = {
  'Status': (r) => getStatusEmoji(r.status),
  'Review ID': (r) => r.id,
  'Branch': (r) => r.branch,
  'Merger': (r) => r.merger,
  'Reviewers': (r) => (r.reviewers || []).map(rv => rv.name).join(', '),
  'Approvals': (r) => `${r.approvalCount}/${r.reviewers ? r.reviewers.length : 0}`,
  'Required': (r) => r.reviewers ? String(r.reviewers.length) : '0',
  'Priority': (r) => r.priority || '',
  'Type': (r) => r.reviewType || '',
  'Created': (r) => r.createdAt ? new Date(r.createdAt).toLocaleString() : '',
  'Commits': (r) => r.commits && r.commits.length > 0 ? r.commits.join(', ') : '',
  'Updated': (r) => r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ''
};

async function getSheetHeaders(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB_NAME}!1:1`
  });
  return (res.data.values && res.data.values[0]) || [];
}

function buildRow(review, sheetHeaders) {
  return sheetHeaders.map(h => {
    const fn = CANONICAL_VALUES[h.trim()];
    return fn ? fn(review) : '';
  });
}

const CANONICAL_KEYS = Object.keys(CANONICAL_VALUES);

async function ensureTabExists(sheets, spreadsheetId) {
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = res.data.sheets.map(s => s.properties.title);
    if (tabs.includes(TAB_NAME)) return;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: TAB_NAME }
          }
        }]
      }
    });

    const lastCol = columnToLetter(CANONICAL_KEYS.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB_NAME}!A1:${lastCol}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [CANONICAL_KEYS] }
    });

    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.13, green: 0.15, blue: 0.25 },
                    textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                    horizontalAlignment: 'CENTER'
                  }
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
              }
            }
          ]
        }
      });
    } catch (e) {
      // styling is best-effort
    }
  } catch (err) {
    console.error('[Sheets] Failed to ensure tab:', err.message);
  }
}

async function syncReviewToSheet(data, reviewId) {
  const sheets = getAuth();
  if (!sheets || !SHEET_ID) return;

  try {
    await ensureTabExists(sheets, SHEET_ID);

    const review = data.reviews.find(r => r.id === reviewId || r.id.endsWith(reviewId));
    if (!review) return;

    const sheetHeaders = await getSheetHeaders(sheets, SHEET_ID);

    const reviewIdIdx = sheetHeaders.findIndex(h => /review\s*id/i.test(h.trim()));
    if (reviewIdIdx < 0) {
      console.error('[Sheets] No "Review ID" column found in sheet headers');
      return;
    }

    const reviewIdCol = columnToLetter(reviewIdIdx + 1);

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!${reviewIdCol}:${reviewIdCol}`
    });

    const values = existing.data.values || [];
    const rowIndex = values.findIndex(row => (row[0] || '').trim() === review.id);

    const rowData = buildRow(review, sheetHeaders);
    const columnCount = Math.min(sheetHeaders.length, CANONICAL_KEYS.length);
    const lastCol = columnToLetter(Math.max(columnCount, 1));

    if (rowIndex >= 1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A${rowIndex + 1}:${lastCol}${rowIndex + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] }
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A:${lastCol}`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowData] }
      });
    }
  } catch (err) {
    console.error('[Sheets] Sync failed:', err.message);
  }
}

async function bulkSyncToSheet(data) {
  const sheets = getAuth();
  if (!sheets || !SHEET_ID) return;

  try {
    await ensureTabExists(sheets, SHEET_ID);

    const activeReviews = data.reviews.filter(r =>
      ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status)
    );

    const sheetHeaders = await getSheetHeaders(sheets, SHEET_ID);
    const rows = activeReviews.map(r => buildRow(r, sheetHeaders));

    const columnCount = Math.min(sheetHeaders.length, CANONICAL_KEYS.length);
    const lastCol = columnToLetter(Math.max(columnCount, 1));

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!A:A`
    });
    const existingRows = (existing.data.values || []).length;
    if (existingRows > 1) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A2:${lastCol}${existingRows}`
      });
    }

    if (rows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A2:${lastCol}${1 + rows.length}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows }
      });
    }

    console.log(`[Sheets] Bulk synced ${rows.length} reviews to ${TAB_NAME}`);
  } catch (err) {
    console.error('[Sheets] Bulk sync failed:', err.message);
  }
}

module.exports = { syncReviewToSheet, bulkSyncToSheet };
