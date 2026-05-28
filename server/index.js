const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const simpleGit = require('simple-git');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data.json');
const SALT_ROUNDS = 10;
const REPO_DIR = path.join(__dirname, '..');
const git = simpleGit(REPO_DIR);

let isGitBusy = false;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

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
          console.warn('[Git] Conflict on push, rebased. Retrying push...');
          await withTimeout(git.add('server/data.json'));
          await withTimeout(git.commit(commitMsg + ' (after rebase)', '--no-verify'));
          await withTimeout(git.push('origin', (await git.branch()).current, ['--no-verify']));
        } catch (retryErr) {
          console.error('[Git] Failed to push after rebase:', retryErr.message);
        }
      } else {
        console.error('[Git] Push failed:', err.message);
      }
    } finally {
      isGitBusy = false;
    }
  });
}

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

async function migratePasswords(data) {
  let changed = false;
  for (const reviewer of data.reviewers) {
    reviewer.discordId = reviewer.discordId || '';
    if (reviewer.password && !isPasswordHashed(reviewer.password)) {
      reviewer.plainPassword = reviewer.password;
      reviewer.password = await hashPassword(reviewer.password);
      changed = true;
    } else if (!reviewer.plainPassword && !reviewer.password) {
      const generated = generatePassword();
      reviewer.plainPassword = generated;
      reviewer.password = await hashPassword(generated);
      changed = true;
    }
  }
  if (changed) {
    saveData(data, 'Migrated plaintext passwords to bcrypt hashes');
    console.log('Migrated plaintext passwords to bcrypt hashes');
  }
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

function selectReviewers(data, reviewType, count, excludeName, size) {
  resetWeeklyCountsIfNeeded(data);
  const sizeToUse = size || determineReviewSize(reviewType, []);
  const available = data.reviewers.filter(r => {
    if (!isReviewableRole(r.role)) return false;
    if (r.name.toLowerCase() === excludeName?.toLowerCase()) return false;
    const cap = getReviewerCapacity(data, r);
    if (cap.weeklyRemaining <= 0) return false;
    if (cap.atCapacity) return false;
    if (sizeToUse === 'large' && !cap.canTakeLarge) return false;
    return true;
  });

  if (available.length === 0) return [];

  const matchingSpecialty = available.filter(r =>
    r.speciality.toLowerCase() === reviewType.toLowerCase() ||
    r.speciality.toLowerCase() === 'fullstack'
  );

  const others = available.filter(r => !matchingSpecialty.includes(r));

  matchingSpecialty.sort((a, b) => a.load - b.load);
  others.sort((a, b) => a.load - b.load);

  const selected = [];
  for (const r of [...matchingSpecialty, ...others]) {
    if (selected.length >= count) break;
    selected.push({ name: r.name, status: 'pending', notified: false });
  }

  return selected;
}

function incrementReviewerLoads(data, reviewers, size) {
  for (const rv of reviewers) {
    const reviewer = getReviewerByName(data, rv.name);
    if (reviewer) {
      reviewer.load = Math.min(reviewer.load + 1, 999);
      reviewer.weeklyCount = (reviewer.weeklyCount || 0) + 1;
      if (size === 'large') {
        reviewer.currentLargeReview = true;
      }
    }
  }
}

function decrementReviewerLoad(data, name, wasLarge) {
  const reviewer = getReviewerByName(data, name);
  if (reviewer) {
    reviewer.load = Math.max(reviewer.load - 1, 0);
    if (wasLarge) {
      reviewer.currentLargeReview = false;
    }
  }
}

function getSeniorReviewer(data) {
  return data.reviewers.find(r => r.role === 'senior');
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

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateReviewId(data) {
  const num = data.settings.nextReviewNumber || 1;
  data.settings.nextReviewNumber = num + 1;
  return `REV-${num}`;
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

// --- Sheets Sync ---
let sheetsSync = null;
try {
  sheetsSync = require('./sheets-sync');
} catch (e) {
  // sheets-sync not available
}

function triggerSheetSync(data, action, reviewId) {
  if (sheetsSync && sheetsSync.syncReviewToSheet) {
    sheetsSync.syncReviewToSheet(data, reviewId).catch(err => {
      console.error('[Sheets] Sync failed:', err.message);
    });
  }
}

// --- API Routes ---

app.use('/api', apiLimiter);

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

  const cap = getReviewerCapacity(data, reviewer);

  res.json({
    name: reviewer.name,
    role: reviewer.role,
    speciality: reviewer.speciality,
    load: reviewer.load,
    weeklyCount: reviewer.weeklyCount || 0,
    weeklyRemaining: cap.weeklyRemaining,
    currentLargeReview: reviewer.currentLargeReview || false,
    hasPassword: !!reviewer.password
  });
});

app.get('/api/reviewers', (req, res) => {
  const data = loadData();
  res.json(data.reviewers.map(r => ({
    name: r.name,
    load: r.load,
    weeklyCount: r.weeklyCount || 0,
    currentLargeReview: r.currentLargeReview || false,
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
  const { branch, merger, reviewType, priority, commits, size } = req.body;
  const data = loadData();

  if (!branch || !merger || !reviewType || !priority) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const count = data.settings.reviewersPerRequest || 3;
  const reviewCommits = commits || [];
  const reviewSize = size || determineReviewSize(reviewType, reviewCommits);
  const reviewers = selectReviewers(data, reviewType, count, merger, reviewSize);

  if (reviewers.length === 0) {
    return res.status(400).json({ error: 'No available reviewers (all at weekly capacity or large limit)' });
  }

  incrementReviewerLoads(data, reviewers, reviewSize);

  const review = {
    id: generateReviewId(data),
    branch,
    reviewType,
    size: reviewSize,
    commits: reviewCommits,
    merger,
    reviewers,
    approvalCount: 0,
    status: 'in_review',
    priority,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    escalation: null,
    comments: []
  };

  data.reviews.push(review);
  saveData(data, `Review ${review.id} created: ${review.branch}`);
  triggerSheetSync(data, 'create', review.id);

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
      decrementReviewerLoad(data, rv.name, review.size === 'large');
    }
  }

  review.status = 'deleted';
  review.deletedBy = userName;
  review.deletedAt = new Date().toISOString();
  review.updatedAt = new Date().toISOString();

  saveData(data, `Review ${req.params.id} deleted by ${userName}`);
  triggerSheetSync(data, 'delete', req.params.id);
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

  decrementReviewerLoad(data, reviewerName, review.size === 'large');

  if (review.approvalCount >= data.settings.reviewersPerRequest) {
    review.status = 'approved';
  }

  saveData(data, `Review ${req.params.id} approved by ${reviewerName}`);
  triggerSheetSync(data, 'update', req.params.id);
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

  decrementReviewerLoad(data, reviewerName, review.size === 'large');

  saveData(data, `Review ${req.params.id} disapproved by ${reviewerName}`);
  triggerSheetSync(data, 'update', req.params.id);
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
      const reviewer = getReviewerByName(data, rv.name);
      if (reviewer) {
        reviewer.load = Math.min(reviewer.load + 1, 999);
        if (review.size === 'large') reviewer.currentLargeReview = true;
      }
    }
  }

  saveData(data, `Review ${req.params.id} marked fix-done`);
  triggerSheetSync(data, 'update', req.params.id);
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
  triggerSheetSync(data, 'update', req.params.id);
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
      decrementReviewerLoad(data, rv.name, review.size === 'large');
    }
  }

  saveData(data, `Review ${req.params.id} escalation decided: ${decision}`);
  triggerSheetSync(data, 'update', req.params.id);
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

app.put('/api/reviewers/:name/weekly', (req, res) => {
  const { weeklyCount } = req.body;
  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);

  if (!reviewer) return res.status(404).json({ error: 'Reviewer not found' });
  if (typeof weeklyCount !== 'number' || weeklyCount < 0) {
    return res.status(400).json({ error: 'weeklyCount must be a non-negative number' });
  }

  reviewer.weeklyCount = weeklyCount;
  saveData(data, `Weekly count set to ${weeklyCount} for ${req.params.name}`);
  res.json(reviewer);
});

app.post('/api/reviews/manual', (req, res) => {
  const { branch, merger, reviewType, priority, reviewers, commits, size } = req.body;
  const data = loadData();

  if (!branch || !merger || !reviewType || !priority || !reviewers || !Array.isArray(reviewers)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const reviewSize = size || 'medium';

  try {
    const reviewReviewers = reviewers.map(name => {
      const reviewer = getReviewerByName(data, name);
      if (!reviewer) throw new Error(`Reviewer not found: ${name}`);
      reviewer.load = Math.min(reviewer.load + 1, 999);
      reviewer.weeklyCount = (reviewer.weeklyCount || 0) + 1;
      if (reviewSize === 'large') reviewer.currentLargeReview = true;
      return { name: reviewer.name, status: 'pending', notified: false };
    });

    const review = {
      id: generateReviewId(data),
      branch,
      reviewType,
      size: reviewSize,
      commits: commits || [],
      merger,
      reviewers: reviewReviewers,
      approvalCount: 0,
      status: 'in_review',
      priority,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      escalation: null,
      comments: []
    };

    data.reviews.push(review);
    saveData(data, `Manual review ${review.id} created: ${review.branch}`);
    triggerSheetSync(data, 'create', review.id);

    res.json(review);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/reviewers', async (req, res) => {
  const { name, speciality, role } = req.body;
  const data = loadData();

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  if (getReviewerByName(data, name)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const finalSpeciality = isNonReviewRole(role || 'reviewer') ? 'None' : (speciality || 'Fullstack');
  const generatedPassword = generatePassword();

  data.reviewers.push({
    name,
    load: 0,
    weeklyCount: 0,
    weeklyResetAt: new Date().toISOString(),
    currentLargeReview: false,
    maxActiveReviews: data.settings.maxWeeklyReviews || 5,
    maxLargeSimultaneous: data.settings.maxLargeSimultaneous || 1,
    speciality: finalSpeciality,
    role: role || 'reviewer',
    email: '',
    password: await hashPassword(generatedPassword),
    plainPassword: generatedPassword,
    discordId: ''
  });

  saveData(data, `User ${name} added`);
  res.json(data.reviewers);
});

// CSV import with proper parser
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

app.post('/api/import-csv', (req, res) => {
  const { csvData } = req.body;

  if (!csvData) {
    return res.status(400).json({ error: 'No CSV data provided' });
  }

  const lines = csvData.trim().split('\n');

  const newReviewers = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const cleaned = values.map(v => v.replace(/"/g, '').trim());

    if (cleaned.length >= 2) {
      newReviewers.push({
        name: cleaned[0],
        load: parseInt(cleaned[1]) || 0,
        weeklyCount: 0,
        weeklyResetAt: new Date().toISOString(),
        currentLargeReview: false,
        maxActiveReviews: 5,
        maxLargeSimultaneous: 1,
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

app.post('/api/reviewers/:name/password', passwordLimiter, async (req, res) => {
  const { password, userRole } = req.body;

  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Only admin can set passwords' });
  }

  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);

  if (!reviewer) return res.status(404).json({ error: 'User not found' });
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  reviewer.password = await hashPassword(password);
  reviewer.plainPassword = password;
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

  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);

  if (!reviewer) return res.status(404).json({ error: 'User not found' });

  const newPassword = generatePassword();
  reviewer.password = await hashPassword(newPassword);
  reviewer.plainPassword = newPassword;
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
    plainPassword: r.plainPassword || ''
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

app.get('/api/settings', (req, res) => {
  const data = loadData();
  const safe = { ...data.settings };
  delete safe.adminPassword;
  res.json(safe);
});

app.put('/api/settings', (req, res) => {
  const data = loadData();
  const oldSettings = { ...data.settings };
  data.settings = { ...data.settings, ...req.body };

  if (req.body.maxWeeklyReviews || req.body.maxLargeSimultaneous) {
    migrateUserDefaults(data, req.body);
  }

  saveData(data, 'Settings updated');
  const safe = { ...data.settings };
  delete safe.adminPassword;
  res.json(safe);
});

function migrateUserDefaults(data, settings) {
  for (const r of data.reviewers) {
    if (settings.maxWeeklyReviews) r.maxActiveReviews = settings.maxWeeklyReviews;
    if (settings.maxLargeSimultaneous) r.maxLargeSimultaneous = settings.maxLargeSimultaneous;
  }
}

app.get('/api/dashboard', (req, res) => {
  const data = loadData();
  const active = data.reviews.filter(r => ['in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status));
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekReviews = data.reviews.filter(r => new Date(r.createdAt) >= weekAgo);
  const reviewable = data.reviewers.filter(r => isReviewableRole(r.role));
  const available = reviewable.filter(r => getReviewerCapacity(data, r).weeklyRemaining > 0);

  res.json({
    activeReviews: active.length,
    totalReviewers: data.reviewers.length,
    reviewableReviewers: reviewable.length,
    availableReviewers: available.length,
    reviewsThisWeek: weekReviews.length,
    approvedThisWeek: weekReviews.filter(r => r.status === 'approved').length,
    rejectedThisWeek: weekReviews.filter(r => r.status === 'rejected').length,
    reviewers: data.reviewers.map(r => ({
      name: r.name,
      load: r.load,
      weeklyCount: r.weeklyCount || 0,
      currentLargeReview: r.currentLargeReview || false,
      capacity: getReviewerCapacity(data, r),
      role: r.role,
      speciality: r.speciality
    }))
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

async function startServer() {
  try {
    const data = loadData();
    migrateReviewerFields(data);
    await migratePasswords(data);

    try {
      console.log('[Git] Pulling latest data from remote...');
      await withTimeout(git.pull('origin', (await git.branch()).current));
      console.log('[Git] Sync complete');
    } catch (err) {
      console.warn('[Git] Pull failed, proceeding with local data:', err.message);
    }

    // Bulk sync sheets on startup
    if (sheetsSync && sheetsSync.bulkSyncToSheet) {
      try {
        const data = loadData();
        await sheetsSync.bulkSyncToSheet(data);
        console.log('[Sheets] Initial bulk sync complete');
      } catch (err) {
        console.warn('[Sheets] Initial bulk sync failed:', err.message);
      }
    }

    app.listen(PORT, () => {
      console.log(`\nReview Maker running at http://localhost:${PORT}`);
      console.log(`Default admin: Admin / root\n`);
      console.log(`Rate limiting: 120 req/min general, 5 login/15min, 10 password/15min\n`);
    });

    // Auto-pull with safety
    setInterval(async () => {
      if (isGitBusy) return;
      isGitBusy = true;
      try {
        await withTimeout(git.pull('origin', (await git.branch()).current));
        console.log('[Auto-Pull] Synced with GitHub');
      } catch (err) {
        console.error('[Auto-Pull] Pull failed:', err.message);
      } finally {
        isGitBusy = false;
      }
    }, 5 * 60 * 1000);
  } catch (err) {
    console.error('[FATAL] Server startup failed:', err.message);
    console.error('Check data.json integrity and try again.');
    process.exit(1);
  }
}

startServer();
