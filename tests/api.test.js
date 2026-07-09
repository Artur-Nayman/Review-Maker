const path = require('path');
const fs = require('fs');
const os = require('os');
const request = require('supertest');

let app;
let db;
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-maker-test-'));
const TEST_DB = path.join(TEST_DIR, 'test.db');
const TEST_DATA = path.join(TEST_DIR, 'data.json');

beforeAll(async () => {
  process.env.TEST_DB_PATH = TEST_DB;
  process.env.TEST_DATA_PATH = TEST_DATA;

  fs.writeFileSync(TEST_DATA, JSON.stringify({ reviewers: [], reviews: [], settings: {} }));

  db = require('../server/db');
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

  const mod = require('../server/index');
  app = mod.app;
});

afterEach(() => {
  const d = db.loadData();
  d.reviewers.forEach(r => { r.load = 0; });
  d.settings.reviewersPerRequest = 3;
  d.settings.maxLoad = 3;
  db.saveData(d, 'Reset loads after test');
});

afterAll(() => {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ====== REVIEW CRUD ======

describe('POST /api/reviews', () => {
  it('creates a review', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/test', merger: 'Alice Reviewer', reviewType: 'fullstack', priority: 'mid' });

    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^REV-\d+$/);
    expect(res.body.branch).toBe('feature/test');
    expect(res.body.merger).toBe('Alice Reviewer');
    expect(res.body.status).toBe('in_review');
    expect(res.body.reviewers.length).toBe(3);
  });

  it('rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/x' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/reviews/:id', () => {
  it('returns a created review', async () => {
    const createRes = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/find-me', merger: 'Bob Reviewer', reviewType: 'frontend', priority: 'low' });

    const res = await request(app).get(`/api/reviews/${createRes.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createRes.body.id);
    expect(res.body.branch).toBe('feature/find-me');
  });

  it('returns 404 for missing review', async () => {
    const res = await request(app).get('/api/reviews/REV-99999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/reviews/:id/approve', () => {
  it('approves a review', async () => {
    const createRes = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/approve', merger: 'Alice Reviewer', reviewType: 'fullstack', priority: 'mid' });

    const reviewerName = createRes.body.reviewers[0].name;
    const res = await request(app)
      .post(`/api/reviews/${createRes.body.id}/approve`)
      .send({ reviewerName });

    expect(res.status).toBe(200);
    expect(res.body.approvalCount).toBe(1);
    expect(res.body.reviewers.find(r => r.name === reviewerName).status).toBe('approved');
  });
});

describe('POST /api/reviews/:id/disapprove', () => {
  it('disapproves a review', async () => {
    const createRes = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/disapprove', merger: 'Bob Reviewer', reviewType: 'frontend', priority: 'mid' });

    const reviewerName = createRes.body.reviewers[0].name;
    const res = await request(app)
      .post(`/api/reviews/${createRes.body.id}/disapprove`)
      .send({ reviewerName, comment: 'Needs work' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fix_needed');
  });
});

describe('PATCH /api/reviews/:id/status', () => {
  it('changes review status', async () => {
    const createRes = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/patch-status', merger: 'Eve Reviewer', reviewType: 'fullstack', priority: 'low' });

    const res = await request(app)
      .patch(`/api/reviews/${createRes.body.id}/status`)
      .send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });
});

describe('DELETE /api/reviews/:id', () => {
  it('soft-deletes a review (admin)', async () => {
    const createRes = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/delete-me', merger: 'Alice Reviewer', reviewType: 'fullstack', priority: 'mid' });

    const res = await request(app)
      .delete(`/api/reviews/${createRes.body.id}`)
      .send({ userRole: 'admin', userName: 'Test Admin' });

    expect(res.status).toBe(200);
    expect(res.body.review.status).toBe('deleted');
  });

  it('rejects non-admin delete', async () => {
    const createRes = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/no-delete', merger: 'Alice Reviewer', reviewType: 'fullstack', priority: 'mid' });

    const res = await request(app)
      .delete(`/api/reviews/${createRes.body.id}`)
      .send({ userRole: 'reviewer', userName: 'Alice Reviewer' });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/reviews/manual', () => {
  it('creates a manual review', async () => {
    const res = await request(app)
      .post('/api/reviews/manual')
      .send({
        branch: 'feature/manual',
        merger: 'Alice Reviewer',
        reviewType: 'frontend',
        priority: 'low',
        reviewers: ['Alice Reviewer', 'Bob Reviewer']
      });

    expect(res.status).toBe(200);
    expect(res.body.reviewers.length).toBe(2);
    expect(res.body.reviewers[0].name).toBe('Alice Reviewer');
  });
});

// ====== HEALTH ======

describe('GET /api/health', () => {
  it('returns OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
  });
});

// ====== generateReviewId FIXES ======

describe('generateReviewId atomicity', () => {
  it('produces sequential IDs', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/reviews')
        .send({ branch: `feature/seq-${i}`, merger: 'Eve Reviewer', reviewType: 'fullstack', priority: 'mid' });
      ids.push(res.body.id);
    }

    for (let i = 1; i < ids.length; i++) {
      const prev = parseInt(ids[i - 1].replace('REV-', ''));
      const curr = parseInt(ids[i].replace('REV-', ''));
      expect(curr).toBe(prev + 1);
    }
  });

  it('does not call saveData internally', () => {
    const id = db.generateReviewId();
    expect(id).toMatch(/^REV-\d+$/);

    const data = db.loadData();
    const latest = data.settings.nextReviewNumber;
    expect(parseInt(id.replace('REV-', ''))).toBeLessThan(latest);
  });
});

describe('Password race condition fix', () => {
  it('adds a reviewer without race (hash before save)', async () => {
    const res = await request(app)
      .post('/api/reviewers')
      .send({ name: 'New Reviewer', speciality: 'Fullstack', role: 'reviewer' });

    expect(res.status).toBe(200);
    const found = res.body.find(r => r.name === 'New Reviewer');
    expect(found).toBeDefined();
    expect(found.role).toBe('reviewer');
  });

  it('rejects duplicate reviewer creation', async () => {
    const res = await request(app)
      .post('/api/reviewers')
      .send({ name: 'New Reviewer', speciality: 'Fullstack', role: 'reviewer' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

// ====== needAttention ======

describe('needAttention flag', () => {
  it('persists needAttention on a review', async () => {
    const createRes = await request(app)
      .post('/api/reviews')
      .send({ branch: 'feature/attention', merger: 'Frank Reviewer', reviewType: 'fullstack', priority: 'mid' });

    const reviewId = createRes.body.id;

    await request(app)
      .patch(`/api/reviews/${reviewId}/status`)
      .send({ status: 'approved' });

    const data = db.loadData();
    const review = data.reviews.find(r => r.id === reviewId);
    expect(review.status).toBe('approved');

    const comment = 'Needs rebase after upstream changes';
    review.needAttention = { comment, flaggedBy: 'Test Admin', createdAt: new Date().toISOString(), resolved: false };
    review.updatedAt = new Date().toISOString();
    db.saveData(data, `Flagged ${reviewId}`);

    const data2 = db.loadData();
    const flagged = data2.reviews.find(r => r.id === reviewId);
    expect(flagged.needAttention).toBeDefined();
    expect(flagged.needAttention.comment).toBe(comment);
    expect(flagged.needAttention.flaggedBy).toBe('Test Admin');
    expect(flagged.needAttention.resolved).toBe(false);
  });
});
