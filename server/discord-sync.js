require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

const SHEET_ID = 'YOUR_SHEET_ID_HERE';
const TAB_NAME = 'Merge Requests';
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let cachedToken = null;
let tokenExpiry = 0;

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

    const [titleRes, branchRes] = await Promise.all([
      sheetsGet('C:C'),
      sheetsGet('G:G')
    ]);

    const titles = (titleRes.values || []).map(r => (r[0] || '').trim().toLowerCase());
    const sourceBranches = (branchRes.values || []).map(r => (r[0] || '').trim().toLowerCase());

    const updates = [];
    for (const review of activeReviews) {
      const rowIdx = findSheetRow(review.branch, titles, sourceBranches);
      if (rowIdx < 0) continue;
      const sheetRow = rowIdx + 1;
      const approvals = `${review.approvalCount}/${review.reviewers ? review.reviewers.length : 0}`;
      const reviewerList = review.reviewers
        ? review.reviewers.map(r => `${r.name}(${r.status === 'approved' ? '✅' : r.status === 'disapproved' ? '❌' : '⏳'})`).join(', ')
        : '';
      updates.push({ row: sheetRow, revId: review.id, approvals, reviewerList });
    }

    if (updates.length === 0) return;

    updates.sort((a, b) => a.row - b.row);
    if (updates.length === 1) {
      await sheetsUpdate(`J${updates[0].row}`, [[updates[0].revId]]);
      await sheetsUpdate(`K${updates[0].row}`, [[updates[0].approvals]]);
      await sheetsUpdate(`U${updates[0].row}`, [[updates[0].reviewerList]]);
    } else {
      await writeColumns(updates, 'J', u => u.revId);
      await writeColumns(updates, 'K', u => u.approvals);
      await writeColumns(updates, 'U', u => u.reviewerList);
    }
  } catch (err) {
    console.error('[DiscordSync] Failed:', err.message);
  }
}

async function bulkSyncDiscordApprovals(data) {
  try {
    const [titleRes, branchRes] = await Promise.all([
      sheetsGet('C:C'),
      sheetsGet('G:G')
    ]);

    const titles = (titleRes.values || []).map(r => (r[0] || '').trim().toLowerCase());
    const sourceBranches = (branchRes.values || []).map(r => (r[0] || '').trim().toLowerCase());

    const updates = [];
    for (const review of data.reviews) {
      const rowIdx = findSheetRow(review.branch, titles, sourceBranches);
      if (rowIdx < 0) continue;
      const sheetRow = rowIdx + 1;
      const approvals = `${review.approvalCount}/${review.reviewers ? review.reviewers.length : 0}`;
      const reviewerList = review.reviewers
        ? review.reviewers.map(r => `${r.name}(${r.status === 'approved' ? '✅' : r.status === 'disapproved' ? '❌' : '⏳'})`).join(', ')
        : '';
      updates.push({ row: sheetRow, revId: review.id, approvals, reviewerList });
    }

    if (updates.length === 0) return;

    updates.sort((a, b) => a.row - b.row);
    await writeColumns(updates, 'J', u => u.revId);
    await writeColumns(updates, 'K', u => u.approvals);
    await writeColumns(updates, 'U', u => u.reviewerList);
  } catch (err) {
    console.error('[DiscordSync] Bulk failed:', err.message);
  }
}

module.exports = { syncDiscordApprovals, bulkSyncDiscordApprovals };
