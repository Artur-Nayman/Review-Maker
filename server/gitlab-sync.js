require('dotenv').config();

const { loadData, saveData, queryOne } = require('./db');

function getGitLabConfig() {
  const gitlabUrl = queryOne("SELECT value FROM settings WHERE key = 'gitlabUrl'");
  const gitlabToken = queryOne("SELECT value FROM settings WHERE key = 'gitlabToken'");
  const gitlabProject = queryOne("SELECT value FROM settings WHERE key = 'gitlabProject'");
  return {
    url: gitlabUrl?.value || '',
    token: gitlabToken?.value || '',
    project: gitlabProject?.value || ''
  };
}

const SHEET_ID = process.env.SHEET_ID || 'YOUR_SHEET_ID_HERE';
const TAB = 'Merge Requests';

async function getAccessToken() {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Google OAuth not configured');
  }
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
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function sheetsGet(token, range) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB + '!' + range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`GET ${range} failed (${res.status})`);
  return res.json();
}

async function sheetsAppend(token, values) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB + '!A:R')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values, majorDimension: 'ROWS' })
    }
  );
  if (!res.ok) throw new Error(`Append failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function sheetsUpdate(token, range, values) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB + '!' + range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values, majorDimension: 'ROWS' })
    }
  );
  if (!res.ok) throw new Error(`PUT ${range} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function fetchGitLabMRs(state = 'opened') {
  const config = getGitLabConfig();
  if (!config.token || !config.url || !config.project || config.url.includes('your-gitlab-instance')) {
    return [];
  }

  const allMRs = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${config.url}/api/v4/projects/${encodeURIComponent(config.project)}/merge_requests?state=${state}&per_page=100&page=${page}`,
      { headers: { 'PRIVATE-TOKEN': config.token } }
    );
    if (!res.ok) {
      if (res.status === 401) {
        console.error('[GitLabSync] Token rejected (401) — check gitlabToken in settings');
        return [];
      }
      throw new Error(`GitLab API error (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    if (data.length === 0) break;
    allMRs.push(...data);
    const totalPages = parseInt(res.headers.get('X-Total-Pages') || '0');
    if (page >= totalPages) break;
    page++;
  }
  return allMRs;
}

function mrToRow(mr, number) {
  const created = new Date(mr.created_at).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  return [
    String(number),
    '!' + mr.iid,
    mr.title,
    mr.author?.name || '',
    mr.assignee?.name || mr.author?.name || '',
    mr.source_branch,
    mr.target_branch,
    '',   // Approved (👍👍👍) — filled by bot
    '',   // Rev ID — filled by bot
    '0/3', // How Much Approved
    '',   // Merged
    '',   // User storie ID
    '',   // Enabler ID
    'In Review', // Final Status
    'not tested', // Testing Status
    mr.web_url,
    created,
    ''    // Notes
  ];
}

async function syncGitLabMRs({ silent } = {}) {
  const log = silent ? () => {} : (msg) => console.log('[GitLabSync]', msg);

  const config = getGitLabConfig();
  if (!config.token || !config.url || !config.project || config.url.includes('your-gitlab-instance')) {
    log('GitLab not configured — skipping');
    return;
  }

  const mrs = await fetchGitLabMRs('opened');
  if (mrs.length === 0) {
    log('No open MRs found');
  } else {
    log(`Fetched ${mrs.length} open MRs from GitLab`);

    try {
      const token = await getAccessToken();
      const sheet = await sheetsGet(token, 'B:B');
      const existingIIDs = new Set();
      if (sheet.values) {
        for (const row of sheet.values) {
          const val = (row[0] || '').toString().trim();
          if (val.startsWith('!')) existingIIDs.add(val);
        }
      }
      log(`${existingIIDs.size} existing MRs in sheet`);

      const toAdd = mrs.filter(mr => !existingIIDs.has('!' + mr.iid));
      if (toAdd.length === 0) {
        log('All MRs already in sheet — nothing to add');
      } else {
        log(`${toAdd.length} new MR(s) to add: ${toAdd.map(m => '!' + m.iid).join(', ')}`);
        const maxNumber = await getMaxNumber(token);
        const newRows = toAdd.map((mr, i) => mrToRow(mr, maxNumber + 1 + i));
        await sheetsAppend(token, newRows);
        log(`Added ${newRows.length} row(s) to sheet`);
      }
    } catch (e) {
      log(`Sheet sync failed: ${e.message}`);
    }
  }

  // Check for merged MRs and auto-close reviews
  try {
    const mergedMRs = await fetchGitLabMRs('merged');
    if (mergedMRs.length > 0) {
      log(`Found ${mergedMRs.length} merged MRs`);
      await autoCloseMergedReviews(mergedMRs, log);
    }
  } catch (e) {
    log(`Merged MR check failed: ${e.message}`);
  }
}

async function autoCloseMergedReviews(mergedMRs, log) {
  const data = loadData();
  let closed = 0;

  for (const mr of mergedMRs) {
    const branch = mr.source_branch;
    const review = data.reviews.find(r =>
      r.status === 'in_review' &&
      (r.branch === branch || r.commitRef === branch || r.id === `!${mr.iid}`)
    );

    if (review) {
      review.status = 'approved';
      review.updatedAt = new Date().toISOString();
      for (const rv of review.reviewers) {
        if (rv.status === 'pending') {
          rv.status = 'approved';
          rv.respondedAt = new Date().toISOString();
        }
      }
      closed++;
      log(`Auto-closed review ${review.id} (MR !${mr.iid} merged)`);
    }
  }

  if (closed > 0) {
    saveData(data, `Auto-closed ${closed} review(s) due to GitLab merge`);
    log(`Auto-closed ${closed} review(s)`);
  }
}

async function getMaxNumber(token) {
  const sheet = await sheetsGet(token, 'A:A');
  if (!sheet.values || sheet.values.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < sheet.values.length; i++) {
    const n = parseInt(sheet.values[i][0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max;
}

module.exports = { syncGitLabMRs };

if (require.main === module) {
  syncGitLabMRs().then(() => process.exit(0)).catch(e => {
    console.error('[GitLabSync] Error:', e.message);
    process.exit(1);
  });
}
