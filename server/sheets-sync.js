const { google } = require('googleapis');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TAB_NAME = 'Review Queue';

let sheetsClient = null;

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

function reviewToRow(review) {
  return [
    getStatusEmoji(review.status),
    review.id,
    review.branch,
    review.merger,
    (review.reviewers || []).map(r => r.name).join(', '),
    `${review.approvalCount}/${review.reviewers ? review.reviewers.length : 0}`,
    review.reviewers ? String(review.reviewers.length) : '0',
    review.priority || '',
    review.reviewType || '',
    review.createdAt ? new Date(review.createdAt).toLocaleString() : '',
    review.commits && review.commits.length > 0 ? review.commits.join(', ') : '',
    review.updatedAt ? new Date(review.updatedAt).toLocaleString() : ''
  ];
}

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

    // Write header row
    const headers = ['Status', 'Review ID', 'Branch', 'Merger', 'Reviewers', 'Approvals', 'Required', 'Priority', 'Type', 'Created', 'Commits', 'Updated'];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB_NAME}!A1:L1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] }
    });

    // Style header
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

    // Check if row exists
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!A:A`
    });

    const values = existing.data.values || [];
    const rowIndex = values.findIndex(row => row[0] === review.id || row[0] === review.id);

    const rowData = reviewToRow(review);

    if (rowIndex >= 1) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A${rowIndex + 1}:L${rowIndex + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [rowData] }
      });
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A:L`,
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

    // Get all active reviews
    const activeReviews = data.reviews.filter(r =>
      ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status)
    );

    const rows = activeReviews.map(r => reviewToRow(r));
    const headers = ['Status', 'Review ID', 'Branch', 'Merger', 'Reviewers', 'Approvals', 'Required', 'Priority', 'Type', 'Created', 'Commits', 'Updated'];

    // Clear existing data (after header)
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!A:A`
    });
    const existingRows = (existing.data.values || []).length;
    if (existingRows > 1) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A2:L${existingRows}`
      });
    }

    // Write header
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${TAB_NAME}!A1:L1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] }
    });

    // Write data
    if (rows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB_NAME}!A2:L${1 + rows.length}`,
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
