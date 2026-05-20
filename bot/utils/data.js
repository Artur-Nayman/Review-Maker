const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

const DATA_PATH = path.join(__dirname, '..', '..', 'server', 'data.json');
const REPO_DIR = path.join(__dirname, '..', '..');
const git = simpleGit(REPO_DIR);

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

let saveQueue = Promise.resolve();

function saveData(data, commitMsg) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');

  if (!commitMsg) return;

  saveQueue = saveQueue.then(async () => {
    try {
      await git.add('server/data.json');
      const status = await git.status();
      if (status.files.length === 0) return;
      await git.commit(commitMsg, '--no-verify');
      await git.push('origin', (await git.branch()).current, ['--no-verify']);
    } catch (err) {
      if (err.message.includes('non-fast-forward') || err.message.includes('conflict')) {
        try {
          await git.pull('origin', (await git.branch()).current, ['--rebase', '--no-verify']);
          console.warn('[Bot Git] Conflict on push, rebased. Retrying push...');
          await git.add('server/data.json');
          await git.commit(commitMsg + ' (after rebase)', '--no-verify');
          await git.push('origin', (await git.branch()).current, ['--no-verify']);
        } catch (retryErr) {
          console.error('[Bot Git] Failed to push after rebase:', retryErr.message);
        }
      } else {
        console.error('[Bot Git] Push failed:', err.message);
      }
    }
  });
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
  saveData(data, 'Incremented review counter');
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

module.exports = {
  loadData,
  saveData,
  getReviewerByName,
  getReviewerByDiscordId,
  isReviewableRole,
  isNonReviewRole,
  generatePassword,
  generateOTP,
  generateReviewId,
  findReviewById,
  getReviewerMention
};
