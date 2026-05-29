const { loadData, saveData, logAudit, generateReviewId: dbGenerateReviewId } = require('../../server/db');

function load() {
  return loadData();
}

function save(data, commitMsg) {
  return saveData(data, commitMsg);
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
  return dbGenerateReviewId(data);
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
  loadData: load,
  saveData: save,
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
