const { execSync } = require('child_process');

const SHEET_ID = 'YOUR_SHEET_ID_HERE';
const TAB_NAME = 'Merge Requests';

function exec(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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

async function ensureColumn() {
  try {
    const existing = JSON.parse(exec(`gog sheets get "${SHEET_ID}" "${TAB_NAME}!U1" --json`));
    const header = existing.values?.[0]?.[0];
    if (header === 'Who Approved') return;
  } catch {}
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
    await ensureColumn();

    const activeReviews = data.reviews.filter(r =>
      ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status)
    );

    if (activeReviews.length === 0) return;

    const srcRaw = JSON.parse(exec(`gog sheets get "${SHEET_ID}" "${TAB_NAME}!C:C" --json`));
    const titles = (srcRaw.values || []).map(r => (r[0] || '').trim().toLowerCase());
    const brRaw = JSON.parse(exec(`gog sheets get "${SHEET_ID}" "${TAB_NAME}!G:G" --json`));
    const sourceBranches = (brRaw.values || []).map(r => (r[0] || '').trim().toLowerCase());

    const updates = [];
    for (const review of activeReviews) {
      const rowIdx = findSheetRow(review.branch, titles, sourceBranches);
      if (rowIdx < 0) continue;

      const sheetRow = rowIdx + 1;
      const approvals = `${review.approvalCount}/${review.reviewers ? review.reviewers.length : 0}`;
      const status = review.status === 'approved' ? '✅' : review.status === 'rejected' ? '❌' : '';
      const reviewerList = review.reviewers ? review.reviewers
        .map(r => `${r.name}(${r.status === 'approved' ? '✅' : r.status === 'disapproved' ? '❌' : '⏳'})`)
        .join(', ') : '';
      const value = `${review.id} ${approvals} ${status}` + (reviewerList ? ` — ${reviewerList}` : '');

      updates.push({ row: sheetRow, value, revId: review.id, approvals, reviewerList });
    }

    if (updates.length === 0) return;

    const valuesJson = JSON.stringify(updates.map(u => [u.value]));
    const rangeStart = updates[0].row;
    const rangeEnd = updates[updates.length - 1].row;

    if (rangeStart === rangeEnd) {
      exec(`gog sheets update "${SHEET_ID}" "${TAB_NAME}!J${rangeStart}" --values-json '[[${JSON.stringify(updates[0].revId)}]]' --input USER_ENTERED`);
      exec(`gog sheets update "${SHEET_ID}" "${TAB_NAME}!K${rangeStart}" --values-json '[[${JSON.stringify(updates[0].approvals)}]]' --input USER_ENTERED`);
      exec(`gog sheets update "${SHEET_ID}" "${TAB_NAME}!U${rangeStart}" --values-json '[[${JSON.stringify(updates[0].reviewerList)}]]' --input USER_ENTERED`);
    } else {
      const fullRange = `${TAB_NAME}!J${rangeStart}:U${rangeEnd}`;
      const fullValues = [];
      let lastRow = rangeStart;
      for (const u of updates) {
        while (lastRow < u.row) {
          fullValues.push(['', '', '']);
          lastRow++;
        }
        fullValues.push([u.revId, u.approvals, u.reviewerList]);
        lastRow++;
      }
      exec(`gog sheets update "${SHEET_ID}" "${fullRange}" --values-json '${JSON.stringify(fullValues)}' --input USER_ENTERED`);
    }
  } catch (err) {
    console.error('[DiscordSync] Failed:', err.message);
  }
}

async function bulkSyncDiscordApprovals(data) {
  try {
    await ensureColumn();

    const srcRaw = JSON.parse(exec(`gog sheets get "${SHEET_ID}" "${TAB_NAME}!C:C" --json`));
    const titles = (srcRaw.values || []).map(r => (r[0] || '').trim().toLowerCase());
    const brRaw = JSON.parse(exec(`gog sheets get "${SHEET_ID}" "${TAB_NAME}!G:G" --json`));
    const sourceBranches = (brRaw.values || []).map(r => (r[0] || '').trim().toLowerCase());

    const updates = [];
    for (const review of data.reviews) {
      const rowIdx = findSheetRow(review.branch, titles, sourceBranches);
      if (rowIdx < 0) continue;

      const sheetRow = rowIdx + 1;
      const approvals = `${review.approvalCount}/${review.reviewers ? review.reviewers.length : 0}`;
      const status = review.status === 'approved' ? '✅' : review.status === 'rejected' ? '❌' : '';
      const reviewerList = review.reviewers ? review.reviewers
        .map(r => `${r.name}(${r.status === 'approved' ? '✅' : r.status === 'disapproved' ? '❌' : '⏳'})`)
        .join(', ') : '';
      updates.push({ row: sheetRow, revId: review.id, approvals, reviewerList });
    }

    if (updates.length === 0) return;

    const sheetRow = updates[0].row;
    const sheetEnd = updates[updates.length - 1].row;

    const values = [];
    let cursor = sheetRow;
    for (const u of updates) {
      while (cursor < u.row) { values.push(['', '', '']); cursor++; }
      values.push([u.revId, u.approvals, u.reviewerList]);
      cursor++;
    }

    exec(`gog sheets update "${SHEET_ID}" "${TAB_NAME}!J${sheetRow}:U${sheetEnd}" --values-json '${JSON.stringify(values)}' --input USER_ENTERED`);
  } catch (err) {
    console.error('[DiscordSync] Bulk failed:', err.message);
  }
}

module.exports = { syncDiscordApprovals, bulkSyncDiscordApprovals };
