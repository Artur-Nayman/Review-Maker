const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'reviewmaker.db');
const DATA_PATH = path.join(__dirname, 'data.json');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS reviewers (
    name TEXT PRIMARY KEY,
    load INTEGER DEFAULT 0,
    speciality TEXT DEFAULT 'Fullstack',
    role TEXT DEFAULT 'reviewer',
    email TEXT DEFAULT '',
    password TEXT DEFAULT '',
    plainPassword TEXT DEFAULT '',
    discordId TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    branch TEXT NOT NULL,
    merger TEXT NOT NULL,
    approvalCount INTEGER DEFAULT 0,
    status TEXT DEFAULT 'in_review',
    priority TEXT DEFAULT 'mid',
    reviewType TEXT DEFAULT 'fullstack',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    escalation TEXT,
    deletedBy TEXT,
    deletedAt TEXT,
    commitRef TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS review_reviewers (
    reviewId TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    comment TEXT DEFAULT '',
    notified INTEGER DEFAULT 0,
    respondedAt TEXT,
    PRIMARY KEY (reviewId, name),
    FOREIGN KEY (reviewId) REFERENCES reviews(id)
  );

  CREATE TABLE IF NOT EXISTS review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reviewId TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (reviewId) REFERENCES reviews(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    user TEXT DEFAULT '',
    timestamp TEXT NOT NULL
  );
`);

try {
  db.exec("ALTER TABLE reviews ADD COLUMN commitRef TEXT DEFAULT ''");
} catch (e) {
  // Column already exists
}

const NUMERIC_SETTINGS = ['nextReviewNumber', 'maxLoad', 'reviewersPerRequest'];

function migrateFromJsonIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) as c FROM reviewers').get().c;
  if (count > 0) return;
  if (!fs.existsSync(DATA_PATH)) return;

  console.log('[DB] Migrating data from data.json to SQLite...');
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  const data = JSON.parse(raw);

  const insertReviewer = db.prepare(`
    INSERT OR REPLACE INTO reviewers (name, load, speciality, role, email, password, plainPassword, discordId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertReview = db.prepare(`
    INSERT OR REPLACE INTO reviews (id, branch, merger, approvalCount, status, priority, reviewType, createdAt, updatedAt, escalation, deletedBy, deletedAt, commitRef)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRv = db.prepare(`
    INSERT OR REPLACE INTO review_reviewers (reviewId, name, status, comment, notified, respondedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertComment = db.prepare(`
    INSERT OR REPLACE INTO review_comments (reviewId, author, text, createdAt)
    VALUES (?, ?, ?, ?)
  `);
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  const transaction = db.transaction(() => {
    for (const r of data.reviewers || []) {
      insertReviewer.run(r.name, r.load || 0, r.speciality || 'Fullstack', r.role || 'reviewer', r.email || '', r.password || '', r.plainPassword || '', r.discordId || '');
    }
    for (const review of data.reviews || []) {
      insertReview.run(review.id, review.branch, review.merger, review.approvalCount || 0, review.status || 'in_review', review.priority || 'mid', review.reviewType || 'fullstack', review.createdAt, review.updatedAt, review.escalation ? JSON.stringify(review.escalation) : null, review.deletedBy || null, review.deletedAt || null, review.commitRef || '');
      for (const rv of review.reviewers || []) {
        insertRv.run(review.id, rv.name, rv.status || 'pending', rv.comment || '', rv.notified ? 1 : 0, rv.respondedAt || null);
      }
      for (const c of review.comments || []) {
        insertComment.run(review.id, c.author, c.text, c.createdAt);
      }
    }
    for (const [key, value] of Object.entries(data.settings || {})) {
      insertSetting.run(key, String(value));
    }
    logAudit('db_migration', 'Migrated from data.json to SQLite', 'system');
  });
  transaction();
  console.log('[DB] Migration complete.');
}

migrateFromJsonIfNeeded();

function logAudit(action, details = '', user = '') {
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO audit_log (action, details, user, timestamp) VALUES (?, ?, ?, ?)').run(action, details, user, timestamp);
}

function getAuditLog(limit = 50, offset = 0) {
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
}

function loadData() {
  const reviewers = db.prepare('SELECT * FROM reviewers').all().map(r => ({
    ...r,
    load: r.load || 0
  }));

  const reviews = db.prepare('SELECT * FROM reviews ORDER BY createdAt DESC').all();
  const getReviewers = db.prepare('SELECT * FROM review_reviewers WHERE reviewId = ?');
  const getComments = db.prepare('SELECT * FROM review_comments WHERE reviewId = ? ORDER BY id');

  for (const review of reviews) {
    review.reviewers = getReviewers.all(review.id).map(rv => ({
      ...rv,
      notified: !!rv.notified
    }));
    review.comments = getComments.all(review.id).map(c => ({
      author: c.author,
      text: c.text,
      createdAt: c.createdAt
    }));
    if (review.escalation) {
      try { review.escalation = JSON.parse(review.escalation); } catch (e) { review.escalation = null; }
    } else {
      review.escalation = null;
    }
    review.approvalCount = review.approvalCount || 0;
  }

  const settings = {};
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  for (const row of settingsRows) {
    settings[row.key] = NUMERIC_SETTINGS.includes(row.key) ? Number(row.value) : row.value;
  }

  if (!settings.nextReviewNumber) settings.nextReviewNumber = 1;
  if (!settings.maxLoad) settings.maxLoad = 3;
  if (!settings.reviewersPerRequest) settings.reviewersPerRequest = 3;
  if (!settings.adminPassword) settings.adminPassword = '';

  return { reviewers, reviews, settings };
}

function saveData(data, commitMsg) {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM review_comments').run();
    db.prepare('DELETE FROM review_reviewers').run();
    db.prepare('DELETE FROM reviews').run();
    db.prepare('DELETE FROM reviewers').run();
    db.prepare('DELETE FROM settings').run();

    const insertReviewer = db.prepare(`
      INSERT INTO reviewers (name, load, speciality, role, email, password, plainPassword, discordId)
      VALUES (@name, @load, @speciality, @role, @email, @password, @plainPassword, @discordId)
    `);
    for (const r of data.reviewers || []) {
      insertReviewer.run({
        name: r.name,
        load: r.load || 0,
        speciality: r.speciality || 'Fullstack',
        role: r.role || 'reviewer',
        email: r.email || '',
        password: r.password || '',
        plainPassword: r.plainPassword || '',
        discordId: r.discordId || ''
      });
    }

    const insertReview = db.prepare(`
      INSERT INTO reviews (id, branch, merger, approvalCount, status, priority, reviewType, createdAt, updatedAt, escalation, deletedBy, deletedAt, commitRef)
      VALUES (@id, @branch, @merger, @approvalCount, @status, @priority, @reviewType, @createdAt, @updatedAt, @escalation, @deletedBy, @deletedAt, @commitRef)
    `);
    const insertRv = db.prepare(`
      INSERT INTO review_reviewers (reviewId, name, status, comment, notified, respondedAt)
      VALUES (@reviewId, @name, @status, @comment, @notified, @respondedAt)
    `);
    const insertComment = db.prepare(`
      INSERT INTO review_comments (reviewId, author, text, createdAt)
      VALUES (@reviewId, @author, @text, @createdAt)
    `);

    for (const review of data.reviews || []) {
      insertReview.run({
        id: review.id,
        branch: review.branch,
        merger: review.merger,
        approvalCount: review.approvalCount || 0,
        status: review.status || 'in_review',
        priority: review.priority || 'mid',
        reviewType: review.reviewType || 'fullstack',
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        escalation: review.escalation ? JSON.stringify(review.escalation) : null,
        deletedBy: review.deletedBy || null,
        deletedAt: review.deletedAt || null,
        commitRef: review.commitRef || ''
      });

      for (const rv of review.reviewers || []) {
        insertRv.run({
          reviewId: review.id,
          name: rv.name,
          status: rv.status || 'pending',
          comment: rv.comment || '',
          notified: rv.notified ? 1 : 0,
          respondedAt: rv.respondedAt || null
        });
      }

      for (const c of review.comments || []) {
        insertComment.run({
          reviewId: review.id,
          author: c.author,
          text: c.text,
          createdAt: c.createdAt
        });
      }
    }

    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value)');
    for (const [key, value] of Object.entries(data.settings || {})) {
      insertSetting.run({ key, value: String(value) });
    }

    if (commitMsg) {
      logAudit('data_change', commitMsg, '');
    }
  });

  transaction();
}

function generateReviewId(data) {
  const num = data.settings.nextReviewNumber || 1;
  data.settings.nextReviewNumber = num + 1;
  saveData(data, 'Incremented review counter');
  return `REV-${num}`;
}

module.exports = {
  loadData,
  saveData,
  logAudit,
  getAuditLog,
  generateReviewId,
  db
};
