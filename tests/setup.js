const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-maker-test-'));
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
const TEST_DATA_PATH = path.join(TEST_DB_DIR, 'data.json');

function cleanupTestDb() {
  try {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

async function initTestDb() {
  process.env.TEST_DB_PATH = TEST_DB_PATH;
  process.env.TEST_DATA_PATH = TEST_DATA_PATH;

  jest.resetModules();

  fs.writeFileSync(TEST_DATA_PATH, JSON.stringify({ reviewers: [], reviews: [], settings: {} }));

  const db = require('../server/db');
  await db.init();

  const data = db.loadData();
  data.settings.nextReviewNumber = 1;
  data.settings.maxLoad = 3;
  data.settings.reviewersPerRequest = 3;

  data.reviewers.push(
    { name: 'Test Admin', load: 0, speciality: 'None', role: 'admin', email: '', password: '', plainPassword: '', discordId: '111111111111111111' },
    { name: 'Alice Reviewer', load: 0, speciality: 'Fullstack', role: 'reviewer', email: '', password: '', plainPassword: '', discordId: '' },
    { name: 'Bob Reviewer', load: 0, speciality: 'Frontend', role: 'reviewer', email: '', password: '', plainPassword: '', discordId: '' },
    { name: 'Charlie Senior', load: 0, speciality: 'Fullstack', role: 'senior', email: '', password: '', plainPassword: '', discordId: '' },
    { name: 'Diana Manager', load: 0, speciality: 'None', role: 'manager', email: '', password: '', plainPassword: '', discordId: '' },
    { name: 'Eve Reviewer', load: 0, speciality: 'Backend', role: 'reviewer', email: '', password: '', plainPassword: '', discordId: '' },
    { name: 'Frank Reviewer', load: 0, speciality: 'Fullstack', role: 'reviewer', email: '', password: '', plainPassword: '', discordId: '' },
    { name: 'Grace Reviewer', load: 0, speciality: 'Frontend', role: 'reviewer', email: '', password: '', plainPassword: '', discordId: '' }
  );

  db.saveData(data, 'Test data initialized');
  return db;
}

module.exports = { cleanupTestDb, initTestDb };
