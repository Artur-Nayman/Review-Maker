const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { loadData, saveData, generateReviewId, logAudit, getAuditLog } = require('./db');

// Crash logger — writes to logs/crash-server.log
const LOG_DIR = path.join(__dirname, '..', 'logs');
function logCrash(message) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    fs.appendFileSync(path.join(LOG_DIR, 'crash-server.log'), `[${timestamp}] ${message}\n`);
  } catch { /* best effort */ }
}

process.on('unhandledRejection', (reason, promise) => {
  const msg = `Unhandled Rejection: ${reason instanceof Error ? reason.message : reason}${reason instanceof Error && reason.stack ? '\n' + reason.stack : ''}`;
  console.error('[FATAL]', msg);
  logCrash(msg);
});

process.on('uncaughtException', (err, origin) => {
  const msg = `Uncaught Exception: ${err.message} (origin: ${origin})${err.stack ? '\n' + err.stack : ''}`;
  console.error('[FATAL]', msg);
  logCrash(msg);
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 10;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many password operations. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Data functions moved to db.js

function getReviewerByName(data, name) {
  return data.reviewers.find(r => r.name.toLowerCase() === name.toLowerCase());
}

function isReviewableRole(role) {
  return role === 'reviewer' || role === 'senior';
}

function isNonReviewRole(role) {
  return role === 'admin' || role === 'manager' || role === 'scrum_master';
}

function isPasswordHashed(password) {
  return password && password.startsWith('$2b$');
}

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function migratePasswords(data) {
  let changed = false;
  for (const reviewer of data.reviewers) {
    reviewer.discordId = reviewer.discordId || '';
    if (reviewer.password && !isPasswordHashed(reviewer.password)) {
      reviewer.password = await hashPassword(reviewer.password);
      changed = true;
    }
  }
  if (changed) {
    saveData(data, 'Migrated plaintext passwords to bcrypt hashes');
    console.log('Migrated plaintext passwords to bcrypt hashes');
  }
}

// Shuffle reviewers within same-load groups to prevent selection bias
function shuffleSameLoad(sorted) {
  const groups = {};
  for (const r of sorted) {
    const load = r.load;
    if (!groups[load]) groups[load] = [];
    groups[load].push(r);
  }
  const result = [];
  for (const load of Object.keys(groups).sort((a, b) => a - b)) {
    const group = groups[load];
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    result.push(...group);
  }
  return result;
}

function selectReviewers(data, reviewType, count, excludeName) {
  const globalMaxLoad = data.settings.maxLoad || 3;
  const available = data.reviewers.filter(r =>
    isReviewableRole(r.role) &&
    !r.disabled &&
    (r.maxLoad > 0 ? r.load < r.maxLoad : r.load < globalMaxLoad) &&
    r.name.toLowerCase() !== excludeName?.toLowerCase()
  );

  if (available.length === 0) return [];

  const matchingSpecialty = available.filter(r =>
    r.speciality.toLowerCase() === reviewType.toLowerCase() ||
    r.speciality.toLowerCase() === 'fullstack'
  );

  const others = available.filter(r => !matchingSpecialty.includes(r));

  matchingSpecialty.sort((a, b) => a.load - b.load);
  others.sort((a, b) => a.load - b.load);

  const shuffled = [...shuffleSameLoad(matchingSpecialty), ...shuffleSameLoad(others)];

  const selected = [];
  for (const r of shuffled) {
    if (selected.length >= count) break;
    selected.push({ name: r.name, status: 'pending', notified: false });
  }

  return selected;
}

function incrementReviewerLoads(data, reviewers) {
  for (const rv of reviewers) {
    const reviewer = getReviewerByName(data, rv.name);
    if (reviewer) reviewer.load = Math.min(reviewer.load + 1, data.settings.maxLoad || 3);
  }
}

function decrementReviewerLoad(data, name) {
  const reviewer = getReviewerByName(data, name);
  if (reviewer) reviewer.load = Math.max(reviewer.load - 1, 0);
}

function getSeniorReviewer(data) {
  return data.reviewers.find(r => r.role === 'senior');
}

function generateOTP() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function findReviewById(data, id) {
  if (id.startsWith('REV-')) {
    return data.reviews.find(r => r.id === id);
  }
  const num = parseInt(id);
  if (!isNaN(num)) {
    return data.reviews.find(r => r.id === `REV-${num}`);
  }
  return data.reviews.find(r => r.id === id);
}

// --- API Routes ---

app.post('/api/login', loginLimiter, async (req, res) => {
  const { name, password } = req.body;
  const data = loadData();
  const reviewer = getReviewerByName(data, name);

  if (!reviewer) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (reviewer.password) {
    if (!password) {
      return res.status(401).json({ error: 'Password required' });
    }
    const valid = await comparePassword(password, reviewer.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password' });
    }
  }

  res.json({
    name: reviewer.name,
    role: reviewer.role,
    speciality: reviewer.speciality,
    load: reviewer.load,
    hasPassword: !!reviewer.password
  });
});

app.get('/api/reviewers', (req, res) => {
  const data = loadData();
  res.json(data.reviewers.map(r => ({
    name: r.name,
    load: r.load,
    speciality: r.speciality,
    role: r.role,
    hasPassword: !!r.password,
    email: r.email || ''
  })));
});

app.get('/api/reviews', (req, res) => {
  const data = loadData();
  const now = new Date();
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

  const active = data.reviews.filter(r => ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status));
  const history = data.reviews.filter(r => {
    const created = new Date(r.createdAt);
    return ['approved', 'rejected', 'deleted'].includes(r.status) && created >= oneMonthAgo;
  });

  res.json({ active, history });
});

app.get('/api/reviews/:id', (req, res) => {
  const data = loadData();
  const review = findReviewById(data, req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  res.json(review);
});

app.post('/api/reviews', (req, res) => {
  const { branch, merger, reviewType, priority, commitRef } = req.body;
  const data = loadData();

  if (!branch || !merger || !reviewType || !priority) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const count = data.settings.reviewersPerRequest || 3;
  const reviewers = selectReviewers(data, reviewType, count, merger);

  if (reviewers.length === 0) {
    return res.status(400).json({ error: 'No available reviewers (all at max load)' });
  }

  incrementReviewerLoads(data, reviewers);

  const deadlineDays = { imp: 5, mid: 7, low: 10 };
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + (deadlineDays[priority] || 7));

  const review = {
    id: generateReviewId(data),
    branch,
    merger,
    reviewers,
    approvalCount: 0,
    status: 'in_review',
    priority,
    reviewType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    escalation: null,
    comments: [],
    commitRef: commitRef || '',
    deadlineAt: deadline.toISOString()
  };

  data.reviews.push(review);
  saveData(data, `Review ${review.id} created: ${review.branch}`);

  res.json(review);
});

app.delete('/api/reviews/:id', (req, res) => {
  const { userRole, userName } = req.body;

  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Only admin and manager can delete reviews' });
  }

  const data = loadData();
  const review = findReviewById(data, req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });

  for (const rv of review.reviewers) {
    if (rv.status === 'pending') {
      decrementReviewerLoad(data, rv.name);
    }
  }

  review.status = 'deleted';
  review.deletedBy = userName;
  review.deletedAt = new Date().toISOString();
  review.updatedAt = new Date().toISOString();

  saveData(data, `Review ${req.params.id} deleted by ${userName}`);
  res.json({ message: 'Review deleted', review });
});

app.post('/api/reviews/:id/approve', (req, res) => {
  const { reviewerName } = req.body;
  const data = loadData();
  const review = findReviewById(data, req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.status !== 'in_review' && review.status !== 'fix_made') {
    return res.status(400).json({ error: 'Review is not in a reviewable state' });
  }

  const rv = review.reviewers.find(r => r.name.toLowerCase() === reviewerName.toLowerCase());
  if (!rv) return res.status(404).json({ error: 'Reviewer not found on this review' });
  if (rv.status !== 'pending') return res.status(400).json({ error: 'Reviewer already responded' });

  rv.status = 'approved';
  rv.respondedAt = new Date().toISOString();
  review.approvalCount++;
  review.updatedAt = new Date().toISOString();

  decrementReviewerLoad(data, reviewerName);

  if (review.approvalCount >= data.settings.reviewersPerRequest) {
    review.status = 'approved';
  }

  saveData(data, `Review ${req.params.id} approved by ${reviewerName}`);
  res.json(review);
});

app.post('/api/reviews/:id/disapprove', (req, res) => {
  const { reviewerName, comment } = req.body;
  const data = loadData();
  const review = findReviewById(data, req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.status !== 'in_review' && review.status !== 'fix_made') {
    return res.status(400).json({ error: 'Review is not in a reviewable state' });
  }

  const rv = review.reviewers.find(r => r.name.toLowerCase() === reviewerName.toLowerCase());
  if (!rv) return res.status(404).json({ error: 'Reviewer not found on this review' });
  if (rv.status !== 'pending') return res.status(400).json({ error: 'Reviewer already responded' });

  rv.status = 'disapproved';
  rv.comment = comment || '';
  rv.respondedAt = new Date().toISOString();
  review.status = 'fix_needed';
  review.updatedAt = new Date().toISOString();

  decrementReviewerLoad(data, reviewerName);

  saveData(data, `Review ${req.params.id} disapproved by ${reviewerName}`);
  res.json(review);
});

app.post('/api/reviews/:id/fix-done', (req, res) => {
  const data = loadData();
  const review = findReviewById(data, req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.status !== 'fix_needed') {
    return res.status(400).json({ error: 'Review is not in fix_needed state' });
  }

  review.status = 'fix_made';
  review.updatedAt = new Date().toISOString();

  for (const rv of review.reviewers) {
    if (rv.status === 'disapproved') {
      rv.status = 'pending';
      rv.comment = '';
      rv.respondedAt = null;
    }
  }

  saveData(data, `Review ${req.params.id} marked fix-done`);
  res.json(review);
});

app.post('/api/reviews/:id/escalate', (req, res) => {
  const { mergerName, reason, userRole } = req.body;
  const data = loadData();
  const review = findReviewById(data, req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.status !== 'fix_needed') {
    return res.status(400).json({ error: 'Can only escalate fix_needed reviews' });
  }

  const isMerger = review.merger.toLowerCase() === mergerName.toLowerCase();
  const isScrumMaster = userRole === 'scrum_master';

  if (!isMerger && !isScrumMaster) {
    return res.status(403).json({ error: 'Only merger or scrum master can escalate' });
  }

  const senior = getSeniorReviewer(data);
  if (!senior) {
    return res.status(400).json({ error: 'No senior reviewer assigned' });
  }

  review.status = 'escalated';
  review.escalation = {
    requestedBy: mergerName,
    reason: reason || '',
    assignedTo: senior.name,
    createdAt: new Date().toISOString()
  };
  review.updatedAt = new Date().toISOString();

  saveData(data, `Review ${req.params.id} escalated by ${mergerName}`);
  res.json(review);
});

app.post('/api/reviews/:id/escalation-decide', (req, res) => {
  const { seniorName, decision } = req.body;
  const data = loadData();
  const review = findReviewById(data, req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.status !== 'escalated') {
    return res.status(400).json({ error: 'Review is not escalated' });
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'Decision must be approve or reject' });
  }

  review.status = decision === 'approve' ? 'approved' : 'rejected';
  review.escalation.decidedAt = new Date().toISOString();
  review.escalation.decision = decision;
  review.updatedAt = new Date().toISOString();

  for (const rv of review.reviewers) {
    if (rv.status === 'disapproved') {
      decrementReviewerLoad(data, rv.name);
    }
  }

  saveData(data, `Review ${req.params.id} escalation decided: ${decision}`);
  res.json(review);
});

app.post('/api/reviews/:id/comment', (req, res) => {
  const { author, text } = req.body;
  const data = loadData();
  const review = findReviewById(data, req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });

  review.comments.push({
    author,
    text,
    createdAt: new Date().toISOString()
  });
  review.updatedAt = new Date().toISOString();

  saveData(data, `Comment added to review ${req.params.id} by ${author}`);
  res.json(review);
});

app.post('/api/reviews/:id/needattention', (req, res) => {
  const { comment, flaggedBy } = req.body;
  const data = loadData();
  const review = findReviewById(data, req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.status !== 'approved') {
    return res.status(400).json({ error: 'Only approved reviews can be flagged for attention' });
  }

  review.needAttention = {
    comment: comment || '',
    flaggedBy: flaggedBy || 'unknown',
    createdAt: new Date().toISOString(),
    resolved: false
  };
  review.updatedAt = new Date().toISOString();

  saveData(data, `Review ${req.params.id} flagged for attention by ${flaggedBy}`);
  res.json(review);
});

app.patch('/api/reviews/:id/edit', (req, res) => {
  const { userRole, updates } = req.body;
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Only admin/manager can edit reviews' });
  }

  const data = loadData();
  const review = findReviewById(data, req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });

  const allowedFields = ['branch', 'merger', 'reviewType', 'priority', 'status', 'commitRef'];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      review[field] = updates[field];
    }
  }
  if (updates.approvalCount !== undefined) {
    review.approvalCount = updates.approvalCount;
  }

  if (Array.isArray(updates.reviewers)) {
    for (const u of updates.reviewers) {
      const existing = review.reviewers.find(r => r.name === u.name);
      if (existing) {
        if (u.status !== undefined) existing.status = u.status;
        if (u.comment !== undefined) existing.comment = u.comment;
      }
    }
  }

  review.updatedAt = new Date().toISOString();
  saveData(data, `Review ${req.params.id} edited by ${req.body.userName || userRole}`);
  res.json(review);
});

app.get('/api/stats', (req, res) => {
  const data = loadData();
  const all = data.reviews;
  const now = new Date();

  const active = all.filter(r => ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status));
  const approved = all.filter(r => r.status === 'approved');
  const fixNeeded = all.filter(r => r.status === 'fix_needed');

  const avgApprovalTime = (() => {
    const completed = all.filter(r => ['approved', 'rejected'].includes(r.status) && r.createdAt && r.updatedAt);
    if (completed.length === 0) return null;
    const totalMs = completed.reduce((sum, r) => sum + (new Date(r.updatedAt) - new Date(r.createdAt)), 0);
    return Math.round(totalMs / completed.length / 3600000 * 10) / 10;
  })();

  res.json({
    totalReviews: all.length,
    activeReviews: active.length,
    approvedReviews: approved.length,
    fixNeeded: fixNeeded.length,
    flaggedForAttention: all.filter(r => r.needAttention && !r.needAttention.resolved).length,
    avgApprovalTimeHours: avgApprovalTime,
    totalReviewers: data.reviewers.length,
    reviewers: data.reviewers.map(r => ({ name: r.name, role: r.role, load: r.load }))
  });
});

app.post('/api/admin/repair-loads', (req, res) => {
  const data = loadData();
  const activeStatuses = ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'];

  for (const r of data.reviewers) {
    r.load = 0;
  }

  for (const review of data.reviews) {
    if (!activeStatuses.includes(review.status)) continue;
    for (const rv of review.reviewers) {
      if (rv.status === 'pending') {
        const reviewer = data.reviewers.find(r => r.name.toLowerCase() === rv.name.toLowerCase());
        if (reviewer) reviewer.load = Math.min(reviewer.load + 1, data.settings.maxLoad || 3);
      }
    }
  }

  saveData(data, 'Reviewer loads repaired');
  res.json({ message: 'Loads recalculated', reviewers: data.reviewers.map(r => ({ name: r.name, load: r.load })) });
});

app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const entries = getAuditLog(limit, offset);
  res.json(entries);
});

app.get('/api/history/reviews', (req, res) => {
  const data = loadData();
  const now = new Date();
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const history = data.reviews.filter(r => {
    const created = new Date(r.createdAt);
    return ['approved', 'rejected', 'deleted'].includes(r.status) && created >= oneMonthAgo;
  });
  res.json(history);
});

app.put('/api/reviewers/:name/role', (req, res) => {
  const { role } = req.body;
  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);

  if (!reviewer) return res.status(404).json({ error: 'Reviewer not found' });
  if (!['reviewer', 'senior', 'scrum_master', 'manager', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  if (role === 'senior') {
    const currentSenior = getSeniorReviewer(data);
    if (currentSenior && currentSenior.name !== reviewer.name) {
      currentSenior.role = 'reviewer';
    }
  }

  if (isNonReviewRole(role)) {
    reviewer.speciality = 'None';
  }

  reviewer.role = role;
  saveData(data, `Role changed for ${req.params.name} to ${role}`);
  res.json(reviewer);
});

app.put('/api/reviewers/:name/load', (req, res) => {
  const { load } = req.body;
  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);

  if (!reviewer) return res.status(404).json({ error: 'Reviewer not found' });
  if (typeof load !== 'number' || load < 0) {
    return res.status(400).json({ error: 'Load must be a non-negative number' });
  }

  reviewer.load = load;
  saveData(data, `Load set to ${load} for ${req.params.name}`);
  res.json(reviewer);
});

app.post('/api/reviews/manual', (req, res) => {
  const { branch, merger, reviewType, priority, reviewers, commitRef } = req.body;
  const data = loadData();

  if (!branch || !merger || !reviewType || !priority || !reviewers || !Array.isArray(reviewers)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const reviewReviewers = reviewers.map(name => {
    const reviewer = getReviewerByName(data, name);
    if (!reviewer) throw new Error(`Reviewer not found: ${name}`);
    reviewer.load = Math.min(reviewer.load + 1, 999);
    return { name: reviewer.name, status: 'pending', notified: false };
  });

  const deadlineDays = { imp: 5, mid: 7, low: 10 };
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + (deadlineDays[priority] || 7));

  const review = {
    id: generateReviewId(data),
    branch,
    merger,
    reviewers: reviewReviewers,
    approvalCount: 0,
    status: 'in_review',
    priority,
    reviewType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    escalation: null,
    comments: [],
    commitRef: commitRef || '',
    deadlineAt: deadline.toISOString()
  };

  data.reviews.push(review);
  saveData(data, `Manual review ${review.id} created: ${review.branch}`);

  res.json(review);
});

app.post('/api/reviewers', async (req, res) => {
  const { name, speciality, role } = req.body;

  let data = loadData();
  if (getReviewerByName(data, name)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const finalSpeciality = isNonReviewRole(role || 'reviewer') ? 'None' : (speciality || 'Fullstack');
  const generatedPassword = generatePassword();
  const hashedPassword = await hashPassword(generatedPassword);

  data = loadData();
  if (getReviewerByName(data, name)) {
    return res.status(400).json({ error: 'User already exists (concurrent creation)' });
  }

  data.reviewers.push({
    name,
    load: 0,
    speciality: finalSpeciality,
    role: role || 'reviewer',
    email: '',
    password: hashedPassword,
    disabled: false,
    maxLoad: 0,
    weeklyCount: 0,
    maxActiveReviews: 0
  });

  saveData(data, `User ${name} added`);
  res.json(data.reviewers);
});

app.delete('/api/reviewers/:name', (req, res) => {
  const data = loadData();
  const idx = data.reviewers.findIndex(r => r.name.toLowerCase() === req.params.name.toLowerCase());

  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (data.reviewers[idx].role === 'admin') {
    return res.status(400).json({ error: 'Cannot delete admin' });
  }

  data.reviewers.splice(idx, 1);
  saveData(data, `User ${req.params.name} removed`);
  res.json(data.reviewers);
});

app.patch('/api/reviewers/:name/reviewer', (req, res) => {
  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);

  if (!reviewer) return res.status(404).json({ error: 'Reviewer not found' });

  const allowedFields = ['role', 'speciality', 'load', 'maxLoad', 'weeklyCount', 'maxActiveReviews', 'disabled', 'email'];
  const updates = {};

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  if (updates.role !== undefined) {
    if (!['reviewer', 'senior', 'scrum_master', 'manager', 'admin'].includes(updates.role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    if (updates.role === 'senior') {
      const currentSenior = getSeniorReviewer(data);
      if (currentSenior && currentSenior.name !== reviewer.name) {
        currentSenior.role = 'reviewer';
      }
    }
    if (isNonReviewRole(updates.role)) {
      updates.speciality = 'None';
    }
    reviewer.role = updates.role;
  }

  if (updates.speciality !== undefined) reviewer.speciality = updates.speciality;
  if (updates.load !== undefined) reviewer.load = Math.max(0, Number(updates.load) || 0);
  if (updates.maxLoad !== undefined) reviewer.maxLoad = Math.max(0, Number(updates.maxLoad) || 0);
  if (updates.weeklyCount !== undefined) reviewer.weeklyCount = Math.max(0, Number(updates.weeklyCount) || 0);
  if (updates.maxActiveReviews !== undefined) reviewer.maxActiveReviews = Math.max(0, Number(updates.maxActiveReviews) || 0);
  if (updates.disabled !== undefined) reviewer.disabled = !!updates.disabled;
  if (updates.email !== undefined) reviewer.email = updates.email;

  saveData(data, `Reviewer ${req.params.name} updated: ${Object.keys(updates).join(', ')}`);
  res.json(reviewer);
});

app.post('/api/reviewers/:name/password', passwordLimiter, async (req, res) => {
  const { password, userRole } = req.body;

  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Only admin can set passwords' });
  }

  let data = loadData();
  if (!getReviewerByName(data, req.params.name)) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const hashedPassword = await hashPassword(password);

  data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);
  if (!reviewer) return res.status(404).json({ error: 'User not found' });

  reviewer.password = hashedPassword;
  reviewer.passwordResetToken = null;
  reviewer.passwordResetExpiry = null;
  saveData(data, `Password set for ${req.params.name}`);
  res.json({ message: 'Password set successfully' });
});

app.post('/api/reviewers/:name/reset-password', passwordLimiter, async (req, res) => {
  const { userRole } = req.body;

  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Only admin can reset passwords' });
  }

  let data = loadData();
  if (!getReviewerByName(data, req.params.name)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const newPassword = generatePassword();
  const hashedPassword = await hashPassword(newPassword);

  data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);
  if (!reviewer) return res.status(404).json({ error: 'User not found' });

  reviewer.password = hashedPassword;
  reviewer.passwordResetToken = null;
  reviewer.passwordResetExpiry = null;
  saveData(data, `Password reset for ${req.params.name}`);

  res.json({ message: 'Password reset', password: newPassword });
});

app.get('/api/admin/passwords', (req, res) => {
  const { userRole } = req.query;

  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Only admin can view passwords' });
  }

  const data = loadData();
  res.json(data.reviewers.map(r => ({
    name: r.name,
    role: r.role,
    hasPassword: !!r.password
  })));
});

app.post('/api/reviewers/:name/email', (req, res) => {
  const { email } = req.body;
  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);

  if (!reviewer) return res.status(404).json({ error: 'User not found' });

  reviewer.email = email || '';
  saveData(data, `Email set for ${req.params.name}`);
  res.json({ message: 'Email updated', email: reviewer.email });
});

app.post('/api/reviewers/:name/link-discord', (req, res) => {
  const { userRole, discordId } = req.body;
  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Only admin can link accounts' });
  }
  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);
  if (!reviewer) return res.status(404).json({ error: 'User not found' });
  if (!discordId) return res.status(400).json({ error: 'discordId required' });

  reviewer.discordId = discordId;
  saveData(data, `Discord link set for ${req.params.name}`);
  res.json({ message: `Discord linked to ${reviewer.name}`, discordId });
});

app.post('/api/reviewers/:name/unlink', (req, res) => {
  const { userRole } = req.body;
  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Only admin can unlink accounts' });
  }
  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);
  if (!reviewer) return res.status(404).json({ error: 'User not found' });

  reviewer.discordId = '';
  saveData(data, `Discord link removed for ${req.params.name}`);
  res.json({ message: `Discord link removed for ${reviewer.name}` });
});

app.post('/api/import-csv', (req, res) => {
  const { csvData } = req.body;

  if (!csvData) {
    return res.status(400).json({ error: 'No CSV data provided' });
  }

  const lines = csvData.trim().split('\n');

  const newReviewers = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
    const cleaned = values.map(v => v.replace(/"/g, '').trim());

    if (cleaned.length >= 2) {
      newReviewers.push({
        name: cleaned[0],
        load: parseInt(cleaned[1]) || 0,
        speciality: cleaned[2] || 'Fullstack',
        role: 'reviewer',
        email: '',
        password: ''
      });
    }
  }

  if (newReviewers.length === 0) {
    return res.status(400).json({ error: 'No valid reviewers found in CSV' });
  }

  const data = loadData();
  const admin = data.reviewers.find(r => r.role === 'admin');
  const senior = data.reviewers.find(r => r.role === 'senior');
  const scrumMaster = data.reviewers.find(r => r.role === 'scrum_master');
  const manager = data.reviewers.find(r => r.role === 'manager');

  data.reviewers = newReviewers;

  if (admin) data.reviewers.push(admin);
  if (senior) data.reviewers.push(senior);
  if (scrumMaster) data.reviewers.push(scrumMaster);
  if (manager) data.reviewers.push(manager);

  saveData(data, `CSV imported: ${newReviewers.length} reviewers`);
  res.json(data.reviewers);
});

app.get('/api/settings', (req, res) => {
  const data = loadData();
  res.json(data.settings);
});

app.put('/api/settings', (req, res) => {
  const data = loadData();
  data.settings = { ...data.settings, ...req.body };
  saveData(data, 'Settings updated');
  res.json(data.settings);
});

app.get('/api/settings/gitlab', (req, res) => {
  const { queryOne } = require('./db');
  const url = queryOne("SELECT value FROM settings WHERE key = 'gitlabUrl'");
  const token = queryOne("SELECT value FROM settings WHERE key = 'gitlabToken'");
  const project = queryOne("SELECT value FROM settings WHERE key = 'gitlabProject'");
  res.json({
    gitlabUrl: url?.value || '',
    gitlabToken: token?.value || '',
    gitlabProject: project?.value || ''
  });
});

app.put('/api/settings/gitlab', (req, res) => {
  const { execute, persist } = require('./db');
  const { gitlabUrl, gitlabToken, gitlabProject } = req.body;
  if (gitlabUrl !== undefined) execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('gitlabUrl', ?)", [gitlabUrl]);
  if (gitlabToken !== undefined) execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('gitlabToken', ?)", [gitlabToken]);
  if (gitlabProject !== undefined) execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('gitlabProject', ?)", [gitlabProject]);
  persist();
  res.json({ message: 'GitLab settings updated' });
});

// --- Debug routes ---
app.use('/api/debug', require('./debug-routes'));

// Update review status (used by dashboard All Reviews tab)
app.patch('/api/reviews/:id/status', (req, res) => {
  const { status } = req.body;
  const data = loadData();
  const review = findReviewById(data, req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (!['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated', 'approved', 'rejected', 'deleted'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  review.status = status;
  review.updatedAt = new Date().toISOString();
  if (status === 'deleted') {
    review.deletedBy = 'dashboard';
    review.deletedAt = new Date().toISOString();
  }
  saveData(data, `Review ${req.params.id} status set to ${status} via dashboard`);
  res.json(review);
});

app.get('/api/health', (req, res) => {
  try {
    const data = loadData();
    res.json({
      status: 'ok',
      db: data && data.reviewers ? 'ok' : 'error',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      db: 'error',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// --- Season Groups (Google Sheets) ---
app.post('/api/sheets/new-group', async (req, res) => {
  const { userRole } = req.body;
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Only admin/manager can create new groups' });
  }
  try {
    const { createSeasonTab } = require('./season-groups');
    const result = await createSeasonTab();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sheets/next-group-name', (req, res) => {
  try {
    const { getNextTabName } = require('./season-groups');
    res.json({ tabName: getNextTabName() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sheets/sync-discord', (req, res) => {
  const { userRole } = req.body;
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Only admin/manager can sync' });
  }
  try {
    const data = loadData();
    require('./discord-sync').bulkSyncDiscordApprovals(data);
    res.json({ message: 'Discord approvals synced' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sheets/bulk-sync', (req, res) => {
  const { userRole } = req.body;
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Only admin/manager can sync' });
  }
  try {
    const data = loadData();
    require('./sheets-sync').bulkSyncToSheet(data);
    res.json({ message: 'Review Queue bulk synced' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function startServer() {
  const db = require('./db');
  await db.init();
  const data = loadData();
  await migratePasswords(data);

  try {
    const { bulkSyncDiscordApprovals } = require('./discord-sync');
    bulkSyncDiscordApprovals(data);
    console.log('[DiscordSync] Initial sync complete');
  } catch (e) {
    console.log('[DiscordSync] Initial sync skipped:', e.message);
  }

  try {
    const { syncGitLabMRs } = require('./gitlab-sync');
    syncGitLabMRs();
    setInterval(() => syncGitLabMRs(), 5 * 60 * 1000);
    console.log('[GitLabSync] Initial sync complete, polling every 5 min');
  } catch (e) {
    console.log('[GitLabSync] Initial sync skipped:', e.message);
  }

  app.listen(PORT, () => {
    console.log(`\nReview Maker running at http://localhost:${PORT}`);
    console.log(`Default admin: Admin / root\n`);
    console.log(`Rate limiting: 5 login attempts per 15 minutes\n`);
  });
}

module.exports = { app, startServer };

if (require.main === module) {
  startServer();
}
