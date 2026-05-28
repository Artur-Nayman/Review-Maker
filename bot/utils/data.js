const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

const DATA_PATH = path.join(__dirname, '..', '..', 'server', 'data.json');
const REPO_DIR = path.join(__dirname, '..', '..');
const git = simpleGit(REPO_DIR);

let isGitBusy = false;

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

let saveQueue = Promise.resolve();

function withTimeout(promise, ms = 30000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Git operation timed out after ${ms}ms`)), ms))
  ]);
}

function saveData(data, commitMsg) {
  const tmp = DATA_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, DATA_PATH);

  if (!commitMsg) return;

  saveQueue = saveQueue.then(async () => {
    if (isGitBusy) return;
    isGitBusy = true;
    try {
      await withTimeout(git.add('server/data.json'));
      const status = await withTimeout(git.status());
      if (status.files.length === 0) return;
      await withTimeout(git.commit(commitMsg, '--no-verify'));
      await withTimeout(git.push('origin', (await git.branch()).current, ['--no-verify']));
    } catch (err) {
      if (err.message.includes('non-fast-forward') || err.message.includes('conflict')) {
        try {
          await withTimeout(git.pull('origin', (await git.branch()).current, ['--rebase', '--no-verify']));
          console.warn('[Bot Git] Conflict on push, rebased. Retrying push...');
          await withTimeout(git.add('server/data.json'));
          await withTimeout(git.commit(commitMsg + ' (after rebase)', '--no-verify'));
          await withTimeout(git.push('origin', (await git.branch()).current, ['--no-verify']));
        } catch (retryErr) {
          console.error('[Bot Git] Failed to push after rebase:', retryErr.message);
        }
      } else {
        console.error('[Bot Git] Push failed:', err.message);
      }
    } finally {
      isGitBusy = false;
    }
  });
}

function migrateReviewerFields(data) {
  let changed = false;
  const now = new Date();
  for (const r of data.reviewers) {
    if (r.weeklyCount === undefined) {
      r.weeklyCount = 0;
      r.weeklyResetAt = now.toISOString();
      changed = true;
    }
    if (r.currentLargeReview === undefined) {
      r.currentLargeReview = false;
      changed = true;
    }
    if (r.maxActiveReviews === undefined) {
      r.maxActiveReviews = data.settings.maxWeeklyReviews || 5;
      changed = true;
    }
    if (r.maxLargeSimultaneous === undefined) {
      r.maxLargeSimultaneous = data.settings.maxLargeSimultaneous || 1;
      changed = true;
    }
    if (r.maxLoad === undefined) {
      r.maxLoad = data.settings.maxLoad || 3;
      changed = true;
    }
  }
  if (changed) {
    saveData(data, 'Migrated reviewer fields');
  }
}

function resetWeeklyCountsIfNeeded(data) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);

  for (const r of data.reviewers) {
    const resetDate = new Date(r.weeklyResetAt);
    if (resetDate < monday) {
      r.weeklyCount = 0;
      r.weeklyResetAt = now.toISOString();
    }
  }
}

function getReviewerCapacity(data, reviewer) {
  resetWeeklyCountsIfNeeded(data);
  const maxWeekly = reviewer.maxActiveReviews || data.settings.maxWeeklyReviews || 5;
  const maxLarge = reviewer.maxLargeSimultaneous || data.settings.maxLargeSimultaneous || 1;
  const maxLoad = reviewer.maxLoad || data.settings.maxLoad || 3;
  return {
    weeklyRemaining: Math.max(0, maxWeekly - (reviewer.weeklyCount || 0)),
    canTakeLarge: !reviewer.currentLargeReview,
    atCapacity: (reviewer.load || 0) >= maxLoad,
    maxWeekly,
    maxLarge,
    maxLoad
  };
}

function getReviewerByName(data, name) {
  return data.reviewers.find(r => r.name.toLowerCase() === name.toLowerCase());
}

function getReviewerByDiscordId(data, discordId) {
  return data.reviewers.find(r => r.discordId === discordId);
}

function isReviewableRole(role) {
  return role === 'reviewer' || role === 'senior';
}

function isNonReviewRole(role) {
  return role === 'admin' || role === 'manager' || role === 'scrum_master';
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateOTP() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateReviewId(data) {
  const num = data.settings.nextReviewNumber || 1;
  data.settings.nextReviewNumber = num + 1;
  return `REV-${num}`;
}

function findReviewById(data, id) {
  if (id && id.startsWith('REV-')) {
    return data.reviews.find(r => r.id === id);
  }
  const num = parseInt(id);
  if (!isNaN(num)) {
    return data.reviews.find(r => r.id === `REV-${num}`);
  }
  return data.reviews.find(r => r.id === id);
}

function getReviewerMention(data, reviewerName) {
  const reviewer = getReviewerByName(data, reviewerName);
  if (reviewer && reviewer.discordId) {
    return `<@${reviewer.discordId}>`;
  }
  return reviewerName;
}

function determineReviewSize(reviewType, commits) {
  if (reviewType === 'commit') {
    const count = commits ? commits.length : 1;
    if (count >= 3) return 'large';
    if (count === 2) return 'medium';
    return 'small';
  }
  return 'medium';
}

module.exports = {
  loadData,
  saveData,
  migrateReviewerFields,
  resetWeeklyCountsIfNeeded,
  getReviewerCapacity,
  getReviewerByName,
  getReviewerByDiscordId,
  isReviewableRole,
  isNonReviewRole,
  generatePassword,
  generateOTP,
  generateReviewId,
  findReviewById,
  getReviewerMention,
  determineReviewSize
};
