const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getReviewerByName(data, name) {
  return data.reviewers.find(r => r.name.toLowerCase() === name.toLowerCase());
}

function selectReviewers(data, reviewType, count, excludeName) {
  const maxLoad = data.settings.maxLoad || 3;
  const available = data.reviewers.filter(r =>
    r.load < maxLoad &&
    r.name.toLowerCase() !== excludeName?.toLowerCase() &&
    r.role !== 'admin' &&
    r.role !== 'scrum_master'
  );

  if (available.length === 0) return [];

  const matchingSpecialty = available.filter(r =>
    r.speciality.toLowerCase() === reviewType.toLowerCase() ||
    r.speciality.toLowerCase() === 'fullstack'
  );

  const others = available.filter(r =>
    !matchingSpecialty.includes(r)
  );

  matchingSpecialty.sort((a, b) => a.load - b.load);
  others.sort((a, b) => a.load - b.load);

  const selected = [];
  for (const r of [...matchingSpecialty, ...others]) {
    if (selected.length >= count) break;
    selected.push({ name: r.name, status: 'pending' });
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

// --- API Routes ---

app.post('/api/login', (req, res) => {
  const { name, password } = req.body;
  const data = loadData();
  const reviewer = getReviewerByName(data, name);

  if (!reviewer) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (reviewer.role === 'admin' && password !== data.settings.adminPassword) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }

  res.json({
    name: reviewer.name,
    role: reviewer.role,
    speciality: reviewer.speciality,
    load: reviewer.load
  });
});

app.get('/api/reviewers', (req, res) => {
  const data = loadData();
  res.json(data.reviewers);
});

app.get('/api/reviews', (req, res) => {
  const data = loadData();
  const now = new Date();
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

  const active = data.reviews.filter(r => ['pending', 'in_review', 'fix_needed', 'fix_made', 'escalated'].includes(r.status));
  const history = data.reviews.filter(r => {
    const created = new Date(r.createdAt);
    return ['approved', 'rejected'].includes(r.status) && created >= oneMonthAgo;
  });

  res.json({ active, history });
});

app.get('/api/reviews/:id', (req, res) => {
  const data = loadData();
  const review = data.reviews.find(r => r.id === req.params.id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  res.json(review);
});

app.post('/api/reviews', (req, res) => {
  const { branch, merger, reviewType, priority } = req.body;
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

  const review = {
    id: uuidv4(),
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
    comments: []
  };

  data.reviews.push(review);
  saveData(data);

  res.json(review);
});

app.post('/api/reviews/:id/approve', (req, res) => {
  const { reviewerName } = req.body;
  const data = loadData();
  const review = data.reviews.find(r => r.id === req.params.id);

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

  saveData(data);
  res.json(review);
});

app.post('/api/reviews/:id/disapprove', (req, res) => {
  const { reviewerName, comment } = req.body;
  const data = loadData();
  const review = data.reviews.find(r => r.id === req.params.id);

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

  saveData(data);
  res.json(review);
});

app.post('/api/reviews/:id/fix-done', (req, res) => {
  const data = loadData();
  const review = data.reviews.find(r => r.id === req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.status !== 'fix_needed') {
    return res.status(400).json({ error: 'Review is not in fix_needed state' });
  }

  review.status = 'fix_made';
  review.updatedAt = new Date().toISOString();

  const newReviewers = selectReviewers(data, review.reviewType, data.settings.reviewersPerRequest, review.merger);

  if (newReviewers.length === 0) {
    return res.status(400).json({ error: 'No available reviewers for re-review' });
  }

  review.reviewers = newReviewers;
  review.approvalCount = 0;
  incrementReviewerLoads(data, newReviewers);

  saveData(data);
  res.json(review);
});

app.post('/api/reviews/:id/escalate', (req, res) => {
  const { mergerName, reason } = req.body;
  const data = loadData();
  const review = data.reviews.find(r => r.id === req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.status !== 'fix_needed') {
    return res.status(400).json({ error: 'Can only escalate fix_needed reviews' });
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

  saveData(data);
  res.json(review);
});

app.post('/api/reviews/:id/escalation-decide', (req, res) => {
  const { seniorName, decision } = req.body;
  const data = loadData();
  const review = data.reviews.find(r => r.id === req.params.id);

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

  saveData(data);
  res.json(review);
});

app.post('/api/reviews/:id/comment', (req, res) => {
  const { author, text } = req.body;
  const data = loadData();
  const review = data.reviews.find(r => r.id === req.params.id);

  if (!review) return res.status(404).json({ error: 'Review not found' });

  review.comments.push({
    author,
    text,
    createdAt: new Date().toISOString()
  });
  review.updatedAt = new Date().toISOString();

  saveData(data);
  res.json(review);
});

app.put('/api/reviewers/:name/role', (req, res) => {
  const { role } = req.body;
  const data = loadData();
  const reviewer = getReviewerByName(data, req.params.name);

  if (!reviewer) return res.status(404).json({ error: 'Reviewer not found' });
  if (!['reviewer', 'senior', 'scrum_master'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  if (role === 'senior') {
    const currentSenior = getSeniorReviewer(data);
    if (currentSenior && currentSenior.name !== reviewer.name) {
      currentSenior.role = 'reviewer';
    }
  }

  reviewer.role = role;
  saveData(data);
  res.json(reviewer);
});

app.post('/api/reviewers', (req, res) => {
  const { name, speciality, role } = req.body;
  const data = loadData();

  if (getReviewerByName(data, name)) {
    return res.status(400).json({ error: 'Reviewer already exists' });
  }

  data.reviewers.push({
    name,
    load: 0,
    speciality: speciality || 'Fullstack',
    role: role || 'reviewer'
  });

  saveData(data);
  res.json(data.reviewers);
});

app.delete('/api/reviewers/:name', (req, res) => {
  const data = loadData();
  const idx = data.reviewers.findIndex(r => r.name.toLowerCase() === req.params.name.toLowerCase());

  if (idx === -1) return res.status(404).json({ error: 'Reviewer not found' });
  if (data.reviewers[idx].role === 'admin') {
    return res.status(400).json({ error: 'Cannot delete admin' });
  }

  data.reviewers.splice(idx, 1);
  saveData(data);
  res.json(data.reviewers);
});

app.post('/api/import-csv', (req, res) => {
  const { csvData } = req.body;

  if (!csvData) {
    return res.status(400).json({ error: 'No CSV data provided' });
  }

  const lines = csvData.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

  const newReviewers = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
    const cleaned = values.map(v => v.replace(/"/g, '').trim());

    if (cleaned.length >= 2) {
      newReviewers.push({
        name: cleaned[0],
        load: parseInt(cleaned[1]) || 0,
        speciality: cleaned[2] || 'Fullstack',
        role: 'reviewer'
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

  data.reviewers = newReviewers;

  if (admin) data.reviewers.push(admin);
  if (senior) data.reviewers.push(senior);
  if (scrumMaster) data.reviewers.push(scrumMaster);

  saveData(data);
  res.json(data.reviewers);
});

app.get('/api/settings', (req, res) => {
  const data = loadData();
  res.json(data.settings);
});

app.put('/api/settings', (req, res) => {
  const data = loadData();
  data.settings = { ...data.settings, ...req.body };
  saveData(data);
  res.json(data.settings);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.listen(PORT, () => {
  console.log(`\nReview Maker running at http://localhost:${PORT}`);
  console.log(`\nDefault admin: Admin / root\n`);
});
