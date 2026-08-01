const { loadData, saveData } = require('./db');

function getGitLabConfig() {
  const db = require('./db');
  const url = db.queryOne("SELECT value FROM settings WHERE key = 'gitlabUrl'");
  const token = db.queryOne("SELECT value FROM settings WHERE key = 'gitlabToken'");
  const project = db.queryOne("SELECT value FROM settings WHERE key = 'gitlabProject'");
  return {
    url: url?.value || process.env.GITLAB_URL || '',
    token: token?.value || process.env.GITLAB_TOKEN || '',
    project: project?.value || process.env.GITLAB_PROJECT || ''
  };
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

async function autoCloseMergedReviews(mergedMRs, log) {
  const data = loadData();
  let closed = 0;

  for (const mr of mergedMRs) {
    const branch = mr.source_branch;
    const review = data.reviews.find(r =>
      r.status === 'in_review' &&
      (r.mrIid === String(mr.iid) || r.branch === branch || r.commitRef === branch || r.id === `!${mr.iid}`)
    );

    if (review) {
      review.status = 'merged';
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

async function fetchMRByIid(iid) {
  const config = getGitLabConfig();
  if (!config.token || !config.url || !config.project) {
    throw new Error('GitLab not configured (missing GITLAB_URL/GITLAB_TOKEN/GITLAB_PROJECT)');
  }
  const url = `${config.url}/api/v4/projects/${encodeURIComponent(config.project)}/merge_requests/${iid}`;
  const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': config.token } });
  if (res.status === 404) throw new Error(`MR !${iid} not found in GitLab`);
  if (!res.ok) throw new Error(`GitLab API error (${res.status}): ${await res.text()}`);
  return res.json();
}

async function checkMergedMRs({ silent } = {}) {
  const log = silent ? () => {} : (msg) => console.log('[GitLabSync]', msg);

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

module.exports = { checkMergedMRs, fetchMRByIid, getGitLabConfig };

if (require.main === module) {
  checkMergedMRs().then(() => process.exit(0)).catch(e => {
    console.error('[GitLabSync] Error:', e.message);
    process.exit(1);
  });
}
