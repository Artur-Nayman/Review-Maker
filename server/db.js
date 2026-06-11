const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.TEST_DB_PATH || path.join(__dirname, 'reviewmaker.db');
const DATA_PATH = process.env.TEST_DATA_PATH || path.join(__dirname, 'data.json');
const NUMERIC_SETTINGS = ['nextReviewNumber', 'maxLoad', 'reviewersPerRequest'];

let db = null;
let initialized = false;
const initQueue = [];

async function init() {
  if (initialized) return;
  if (initQueue.length > 0) return new Promise(resolve => initQueue.push(resolve));

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS reviewers (
      name TEXT PRIMARY KEY,
      load INTEGER DEFAULT 0,
      speciality TEXT DEFAULT 'Fullstack',
      role TEXT DEFAULT 'reviewer',
      email TEXT DEFAULT '',
      password TEXT DEFAULT ''
    )
  `);
  db.run(`
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
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS review_reviewers (
      reviewId TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      comment TEXT DEFAULT '',
      notified INTEGER DEFAULT 0,
      respondedAt TEXT,
      PRIMARY KEY (reviewId, name),
      FOREIGN KEY (reviewId) REFERENCES reviews(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS review_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reviewId TEXT NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (reviewId) REFERENCES reviews(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      user TEXT DEFAULT '',
      timestamp TEXT NOT NULL
    )
  `);

  try {
    db.run("ALTER TABLE reviews ADD COLUMN commitRef TEXT DEFAULT ''");
  } catch (e) {
    // Column already exists
  }
  try {
    db.run("ALTER TABLE reviews ADD COLUMN needAttention TEXT");
  } catch (e) {
    // Column already exists
  }
  try {
    db.run("ALTER TABLE reviewers ADD COLUMN disabled INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists
  }
  try {
    db.run("ALTER TABLE reviewers ADD COLUMN maxLoad INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists
  }
  try {
    db.run("ALTER TABLE reviewers ADD COLUMN weeklyCount INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists
  }
  try {
    db.run("ALTER TABLE reviewers ADD COLUMN maxActiveReviews INTEGER DEFAULT 0");
  } catch (e) {
    // Column already exists
  }
  try {
    db.run("ALTER TABLE reviews ADD COLUMN deadlineAt TEXT");
  } catch (e) {
    // Column already exists
  }

  initialized = true;
  migrateFromJsonIfNeeded();

  for (const resolve of initQueue) resolve();
  initQueue.length = 0;
}

function ensureInit() {
  if (!initialized) throw new Error('Database not initialized. Call init() first.');
}

function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function queryAll(sql, params = []) {
  ensureInit();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  ensureInit();
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function execute(sql, params = []) {
  ensureInit();
  db.run(sql, params);
}

function migrateFromJsonIfNeeded() {
  const count = queryOne('SELECT COUNT(*) as c FROM reviewers');
  if (count && count.c > 0) return;
  if (!fs.existsSync(DATA_PATH)) return;

  console.log('[DB] Migrating data from data.json to SQLite...');
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  const data = JSON.parse(raw);

  db.run('BEGIN');
  try {
    for (const r of data.reviewers || []) {
      execute('INSERT OR REPLACE INTO reviewers (name, load, speciality, role, email, password, disabled, maxLoad, weeklyCount, maxActiveReviews) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [r.name, r.load || 0, r.speciality || 'Fullstack', r.role || 'reviewer', r.email || '', r.password || '', r.disabled ? 1 : 0, r.maxLoad || 0, r.weeklyCount || 0, r.maxActiveReviews || 0]);
    }
    for (const review of data.reviews || []) {
      execute('INSERT OR REPLACE INTO reviews (id, branch, merger, approvalCount, status, priority, reviewType, createdAt, updatedAt, escalation, deletedBy, deletedAt, commitRef, needAttention, deadlineAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [review.id, review.branch, review.merger, review.approvalCount || 0, review.status || 'in_review', review.priority || 'mid', review.reviewType || 'fullstack', review.createdAt, review.updatedAt, review.escalation ? JSON.stringify(review.escalation) : null, review.deletedBy || null, review.deletedAt || null, review.commitRef || '', review.needAttention ? JSON.stringify(review.needAttention) : null, review.deadlineAt || null]);
      for (const rv of review.reviewers || []) {
        execute('INSERT OR REPLACE INTO review_reviewers (reviewId, name, status, comment, notified, respondedAt) VALUES (?, ?, ?, ?, ?, ?)', [review.id, rv.name, rv.status || 'pending', rv.comment || '', rv.notified ? 1 : 0, rv.respondedAt || null]);
      }
      for (const c of review.comments || []) {
        execute('INSERT OR REPLACE INTO review_comments (reviewId, author, text, createdAt) VALUES (?, ?, ?, ?)', [review.id, c.author, c.text, c.createdAt]);
      }
    }
    for (const [key, value] of Object.entries(data.settings || {})) {
      execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    }
    execute("INSERT INTO audit_log (action, details, user, timestamp) VALUES (?, ?, ?, ?)", ['db_migration', 'Migrated from data.json to SQLite', 'system', new Date().toISOString()]);
    db.run('COMMIT');
    persist();
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }

  console.log('[DB] Migration complete.');
}

function logAudit(action, details = '', user = '') {
  execute("INSERT INTO audit_log (action, details, user, timestamp) VALUES (?, ?, ?, ?)", [action, details, user, new Date().toISOString()]);
  persist();
}

function getAuditLog(limit = 50, offset = 0) {
  return queryAll('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
}

function loadData() {
  ensureInit();
  const reviewers = queryAll('SELECT * FROM reviewers').map(r => ({
    ...r,
    load: r.load || 0,
    disabled: !!r.disabled,
    maxLoad: r.maxLoad || 0,
    weeklyCount: r.weeklyCount || 0,
    maxActiveReviews: r.maxActiveReviews || 0
  }));

  const reviews = queryAll('SELECT * FROM reviews ORDER BY createdAt DESC');

  for (const review of reviews) {
    review.reviewers = queryAll('SELECT * FROM review_reviewers WHERE reviewId = ?', [review.id]).map(rv => ({
      ...rv,
      notified: !!rv.notified
    }));
    review.comments = queryAll('SELECT * FROM review_comments WHERE reviewId = ? ORDER BY id', [review.id]).map(c => ({
      author: c.author,
      text: c.text,
      createdAt: c.createdAt
    }));
    if (review.escalation) {
      try { review.escalation = JSON.parse(review.escalation); } catch (e) { review.escalation = null; }
    } else {
      review.escalation = null;
    }
    if (review.needAttention) {
      try { review.needAttention = JSON.parse(review.needAttention); } catch (e) { review.needAttention = null; }
    } else {
      review.needAttention = null;
    }
    review.approvalCount = review.approvalCount || 0;
  }

  const settings = {};
  const settingsRows = queryAll('SELECT key, value FROM settings');
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
  ensureInit();
  db.run('BEGIN');
  try {
    execute('DELETE FROM review_comments');
    execute('DELETE FROM review_reviewers');
    execute('DELETE FROM reviews');
    execute('DELETE FROM reviewers');
    execute('DELETE FROM settings');

    for (const r of data.reviewers || []) {
      execute('INSERT INTO reviewers (name, load, speciality, role, email, password, disabled, maxLoad, weeklyCount, maxActiveReviews) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [r.name, r.load || 0, r.speciality || 'Fullstack', r.role || 'reviewer', r.email || '', r.password || '', r.disabled ? 1 : 0, r.maxLoad || 0, r.weeklyCount || 0, r.maxActiveReviews || 0]);
    }

    for (const review of data.reviews || []) {
      execute('INSERT INTO reviews (id, branch, merger, approvalCount, status, priority, reviewType, createdAt, updatedAt, escalation, deletedBy, deletedAt, commitRef, needAttention, deadlineAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [review.id, review.branch, review.merger, review.approvalCount || 0, review.status || 'in_review', review.priority || 'mid', review.reviewType || 'fullstack', review.createdAt, review.updatedAt, review.escalation ? JSON.stringify(review.escalation) : null, review.deletedBy || null, review.deletedAt || null, review.commitRef || '', review.needAttention ? JSON.stringify(review.needAttention) : null, review.deadlineAt || null]);

      for (const rv of review.reviewers || []) {
        execute('INSERT INTO review_reviewers (reviewId, name, status, comment, notified, respondedAt) VALUES (?, ?, ?, ?, ?, ?)', [review.id, rv.name, rv.status || 'pending', rv.comment || '', rv.notified ? 1 : 0, rv.respondedAt || null]);
      }

      for (const c of review.comments || []) {
        execute('INSERT INTO review_comments (reviewId, author, text, createdAt) VALUES (?, ?, ?, ?)', [review.id, c.author, c.text, c.createdAt]);
      }
    }

    for (const [key, value] of Object.entries(data.settings || {})) {
      execute('INSERT INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    }

    if (commitMsg) {
      execute("INSERT INTO audit_log (action, details, user, timestamp) VALUES (?, ?, ?, ?)", ['data_change', commitMsg, '', new Date().toISOString()]);
    }

    db.run('COMMIT');
    persist();
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }

  try {
    const hasReviews = (data.reviews || []).length > 0;
    if (hasReviews) {
      const { syncDiscordApprovals } = require('./discord-sync');
      syncDiscordApprovals(data);
    }
  } catch (e) {
    // Discord sync is best-effort
  }
}

function generateReviewId(data) {
  ensureInit();
  const row = queryOne('SELECT value FROM settings WHERE key = ?', ['nextReviewNumber']);
  const num = row ? (Number(row.value) || 1) : 1;
  execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['nextReviewNumber', String(num + 1)]);
  persist();
  if (data && data.settings) {
    data.settings.nextReviewNumber = num + 1;
  }
  return `REV-${num}`;
}

module.exports = {
  init,
  loadData,
  saveData,
  logAudit,
  getAuditLog,
  generateReviewId,
  queryAll,
  queryOne,
  execute,
  ensureInit
};
