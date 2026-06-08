require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const SHEET_ID = 'YOUR_SHEET_ID_HERE';
const TAB_NAME = 'Merge Requests';
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let cachedToken = null;
let tokenExpiry = 0;

function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    col--;
    letter = String.fromCharCode(65 + (col % 26)) + letter;
    col = Math.floor(col / 26);
  }
  return letter;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function sheetsGet(range) {
  const token = await getAccessToken();
  const url = `${API_BASE}/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME + '!' + range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets GET ${range} failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function sheetsUpdate(range, values) {
  const token = await getAccessToken();
  const url = `${API_BASE}/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME + '!' + range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values, majorDimension: 'ROWS' })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets PUT ${range} failed (${res.status}): ${err}`);
  }
  return res.json();
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

async function getSheetHeaders() {
  const data = await sheetsGet('1:1');
  return (data.values && data.values[0]) || [];
}

async function resolveColumns() {
  const headers = await getSheetHeaders();
  const cleanHeaders = headers.map(h => h.trim().toLowerCase());

  const titleIdx = cleanHeaders.findIndex(h => h === 'title');
  const sourceIdx = cleanHeaders.findIndex(h => /source.*branch|branch.*source/.test(h));
  const revIdIdx = cleanHeaders.findIndex(h => /rev.*id|review.*id/.test(h));
  const approvalsIdx = cleanHeaders.findIndex(h => /how much approved|approvals?(\s|$)/i.test(h));

  return {
    headers,
    titleCol: titleIdx >= 0 ? columnToLetter(titleIdx + 1) : null,
    sourceCol: sourceIdx >= 0 ? columnToLetter(sourceIdx + 1) : null,
    revIdCol: revIdIdx >= 0 ? columnToLetter(revIdIdx + 1) : null,
    approvalsCol: approvalsIdx >= 0 ? columnToLetter(approvalsIdx + 1) : null
  };
}

function findSheetRow(reviewBranch, titles, sourceBranches) {
  const branch = (reviewBranch || '').trim().toLowerCase();
  let idx = sourceBranches.findIndex(b => b === branch);
  if (idx >= 0) return idx;
  idx = titles.findIndex(b => b === branch);
  return idx;
}

async function syncDiscordApprovals(data) {
  try {
    const activeReviews = data.reviews.filter(r =>
      ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status)
    );
    if (activeReviews.length === 0) return;

    const cols = await resolveColumns();
    if (!cols.titleCol || !cols.sourceCol) {
      console.error('[DiscordSync] Required columns (Title, Source Branch) not found in sheet headers');
      return;
    }

    const [titleRes, branchRes] = await Promise.all([
      sheetsGet(`${cols.titleCol}:${cols.titleCol}`),
      sheetsGet(`${cols.sourceCol}:${cols.sourceCol}`)
    ]);

    const titles = (titleRes.values || []).map(r => (r[0] || '').trim().toLowerCase());
    const sourceBranches = (branchRes.values || []).map(r => (r[0] || '').trim().toLowerCase());

    const updates = [];
    for (const review of activeReviews) {
      const rowIdx = findSheetRow(review.branch, titles, sourceBranches);
      if (rowIdx < 0) continue;
      const sheetRow = rowIdx + 1;
      const approvals = `${review.approvalCount}/${review.reviewers ? review.reviewers.length : 0}`;
      updates.push({ row: sheetRow, revId: review.id, approvals });
    }

    if (updates.length === 0) return;

    updates.sort((a, b) => a.row - b.row);

    if (updates.length === 1) {
      if (cols.revIdCol) {
        await sheetsUpdate(`${cols.revIdCol}${updates[0].row}`, [[updates[0].revId]]);
      }
      if (cols.approvalsCol) {
        await sheetsUpdate(`${cols.approvalsCol}${updates[0].row}`, [[updates[0].approvals]]);
      }
    } else {
      if (cols.revIdCol) {
        await writeColumns(updates, cols.revIdCol, u => u.revId);
      }
      if (cols.approvalsCol) {
        await writeColumns(updates, cols.approvalsCol, u => u.approvals);
      }
    }
  } catch (err) {
    console.error('[DiscordSync] Failed:', err.message);
  }
}

async function bulkSyncDiscordApprovals(data) {
  try {
    const cols = await resolveColumns();
    if (!cols.titleCol || !cols.sourceCol) {
      console.error('[DiscordSync] Required columns (Title, Source Branch) not found in sheet headers');
      return;
    }

    const [titleRes, branchRes] = await Promise.all([
      sheetsGet(`${cols.titleCol}:${cols.titleCol}`),
      sheetsGet(`${cols.sourceCol}:${cols.sourceCol}`)
    ]);

    const titles = (titleRes.values || []).map(r => (r[0] || '').trim().toLowerCase());
    const sourceBranches = (branchRes.values || []).map(r => (r[0] || '').trim().toLowerCase());

    const updates = [];
    for (const review of data.reviews) {
      const rowIdx = findSheetRow(review.branch, titles, sourceBranches);
      if (rowIdx < 0) continue;
      const sheetRow = rowIdx + 1;
      const approvals = `${review.approvalCount}/${review.reviewers ? review.reviewers.length : 0}`;
      updates.push({ row: sheetRow, revId: review.id, approvals });
    }

    if (updates.length === 0) return;

    updates.sort((a, b) => a.row - b.row);
    if (cols.revIdCol) {
      await writeColumns(updates, cols.revIdCol, u => u.revId);
    }
    if (cols.approvalsCol) {
      await writeColumns(updates, cols.approvalsCol, u => u.approvals);
    }
  } catch (err) {
    console.error('[DiscordSync] Bulk failed:', err.message);
  }
}

async function writeColumns(updates, col, getValue) {
  const startRow = updates[0].row;
  const endRow = updates[updates.length - 1].row;
  const rows = [];
  let cursor = startRow;
  for (const u of updates) {
    while (cursor < u.row) { rows.push(['']); cursor++; }
    rows.push([getValue(u)]);
    cursor++;
  }
  await sheetsUpdate(`${col}${startRow}:${col}${endRow}`, rows);
}

module.exports = { syncDiscordApprovals, bulkSyncDiscordApprovals };
