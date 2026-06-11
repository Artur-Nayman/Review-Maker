require('dotenv').config();

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const PROJECT = 'your-project-path';
const GITLAB_API = 'https://your-gitlab-instance.com/api/v4';
const SHEET_ID = 'YOUR_SHEET_ID_HERE';
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

async function fetchGitLabMRs() {
  if (!GITLAB_TOKEN || GITLAB_API.includes('your-gitlab-instance') || PROJECT === 'your-project-path') {
    console.log('[GitLabSync] GitLab not configured — skipping (set GITLAB_API and PROJECT in config)');
    return [];
  }

  const allMRs = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${GITLAB_API}/projects/${PROJECT}/merge_requests?state=opened&per_page=100&page=${page}`,
      { headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN } }
    );
    if (!res.ok) {
      if (res.status === 401) {
        console.error('[GitLabSync] Token rejected (401) — check GITLAB_TOKEN');
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

  const mrs = await fetchGitLabMRs();
  if (mrs.length === 0) {
    log('No open MRs found');
    return;
  }
  log(`Fetched ${mrs.length} open MRs from GitLab`);

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
    return;
  }
  log(`${toAdd.length} new MR(s) to add: ${toAdd.map(m => '!' + m.iid).join(', ')}`);

  const maxNumber = await getMaxNumber(token);
  const newRows = toAdd.map((mr, i) => mrToRow(mr, maxNumber + 1 + i));

  await sheetsAppend(token, newRows);
  log(`Added ${newRows.length} row(s) to sheet`);
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
