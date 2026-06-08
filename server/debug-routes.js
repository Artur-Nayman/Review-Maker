const express = require('express');
const router = express.Router();
const simpleGit = require('simple-git');
const path = require('path');
const logger = require('./logger');
const db = require('./db');

const projectRoot = path.join(__dirname, '..');
const git = simpleGit(projectRoot);

const BLOCKED_KEYWORDS = /\b(insert|update|delete|drop|alter|create|truncate|replace|exec|eval|attach|detach|vacuum)\b/i;

function requireAdmin(req, res, next) {
  const role = req.body.userRole || req.query.userRole;
  if (role !== 'admin' && role !== 'manager') {
    return res.status(403).json({ error: 'Admin/manager role required' });
  }
  next();
}

router.get('/logs', requireAdmin, (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  const entries = logger.readLast(Math.min(lines, 5000));
  res.json({ entries, total: entries.length });
});

router.get('/db/tables', requireAdmin, (req, res) => {
  const tables = db.queryAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const result = tables.map(t => {
    const count = db.queryOne(`SELECT COUNT(*) as count FROM "${t.name}"`);
    const info = db.queryAll(`PRAGMA table_info("${t.name}")`);
    return {
      name: t.name,
      rowCount: count ? count.count : 0,
      columns: info.map(c => ({
        name: c.name,
        type: c.type,
        pk: c.pk === 1
      }))
    };
  });
  res.json(result);
});

router.get('/db/table/:name', requireAdmin, (req, res) => {
  const name = req.params.name.replace(/[^a-zA-Z0-9_]/g, '');
  if (!name) return res.status(400).json({ error: 'Invalid table name' });

  try {
    const info = db.queryAll(`PRAGMA table_info("${name}")`);
    if (info.length === 0) return res.status(404).json({ error: 'Table not found' });

    const columns = info.map(c => c.name);
    const rows = db.queryAll(`SELECT * FROM "${name}" ORDER BY rowid DESC LIMIT 500`);

    res.json({ columns, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/db/query', requireAdmin, (req, res) => {
  const { sql } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'SQL query required' });
  }
  if (BLOCKED_KEYWORDS.test(sql.trim())) {
    return res.status(400).json({ error: 'Only SELECT queries are allowed' });
  }

  try {
    const rows = db.queryAll(sql);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ columns, rows, count: rows.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/db/row/:table', requireAdmin, (req, res) => {
  const table = req.params.table.replace(/[^a-zA-Z0-9_]/g, '');
  if (!table) return res.status(400).json({ error: 'Invalid table name' });

  const { idColumn, idValue, updates } = req.body;
  if (!idColumn || idValue === undefined || !updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'idColumn, idValue, and updates object required' });
  }

  try {
    const setClauses = [];
    const params = [];
    for (const [key, value] of Object.entries(updates)) {
      const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, '');
      if (cleanKey) {
        setClauses.push(`"${cleanKey}" = ?`);
        params.push(value);
      }
    }
    params.push(idValue);
    db.execute(`UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "${idColumn}" = ?`, params);
    db.logAudit(`debug_update`, `Updated ${table}.${idColumn}=${idValue}: ${setClauses.length} fields`, req.body.userName || 'debug');
    res.json({ success: true, updatedFields: setClauses.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sheets/columns', requireAdmin, async (req, res) => {
  const tabName = req.query.tab;
  if (!tabName) return res.status(400).json({ error: 'tab query param required' });

  try {
    let sheets;
    try {
      const { google } = require('googleapis');
      const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
      const credsPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
      let credentials;
      if (credsJson) credentials = JSON.parse(credsJson);
      else if (credsPath) credentials = require(path.resolve(credsPath));
      if (credentials) {
        const auth = new google.auth.JWT(credentials.client_email, null, credentials.private_key, ['https://www.googleapis.com/auth/spreadsheets']);
        sheets = google.sheets({ version: 'v4', auth });
      }
    } catch {}

    if (!sheets) {
      return res.json({ available: false, reason: 'No Google credentials configured' });
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) return res.json({ available: false, reason: 'No GOOGLE_SHEET_ID' });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!1:1`
    });
    const headers = (result.data.values && result.data.values[0]) || [];
    const cols = headers.map((h, i) => ({
      index: i,
      column: String.fromCharCode(65 + i),
      header: h
    }));

    res.json({ available: true, tabName, columns: cols });
  } catch (err) {
    res.json({ available: true, error: err.message });
  }
});

router.get('/git/status', requireAdmin, async (req, res) => {
  try {
    const [branch, log, status] = await Promise.all([
      git.branch(),
      git.log({ maxCount: 5 }),
      git.status()
    ]);
    res.json({
      branch: branch.current,
      commits: log.all.map(c => ({ hash: c.hash.slice(0, 7), message: c.message, date: c.date })),
      dirty: status.files.map(f => f.path),
      ahead: status.ahead,
      behind: status.behind
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

module.exports = router;
