import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import { createReviewsRouter } from '../reviews.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, tokensDao, usersDao } from '../../oauth/dao.js';

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CUID2_REGEX = /^[a-z0-9]{24,}$/;

let app: express.Express;
const testDbPath = join(tmpdir(), `foundry-test-reviews-${Date.now()}.db`);

// OAuth test identities for S8 identity-propagation tests.
let oauthUserId: string;
let interactiveClientId: string;
let autonomousClientId: string;
let interactiveAccessToken: string;
let autonomousAccessToken: string;

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  process.env.FOUNDRY_WRITE_TOKEN = 'test-token';
  process.env.FOUNDRY_OAUTH_ISSUER = process.env.FOUNDRY_OAUTH_ISSUER || 'https://foundry.test';

  // Force DB init before DAO usage (schema creation happens inside getDb).
  getDb();

  const oauthUser = usersDao.upsert({ github_login: 'pip', github_id: 30303 });
  oauthUserId = oauthUser.id;

  const interactiveClient = clientsDao.register({
    name: 'Interactive Reviews Client',
    redirect_uris: 'https://example.com/cb',
    client_type: 'interactive',
  });
  interactiveClientId = interactiveClient.id;

  const autonomousClient = clientsDao.register({
    name: 'Autonomous Reviews Client',
    redirect_uris: 'https://example.com/cb',
    client_type: 'autonomous',
  });
  autonomousClientId = autonomousClient.id;

  interactiveAccessToken = tokensDao.mint({
    client_id: interactiveClientId,
    user_id: oauthUserId,
    scope: 'docs:read docs:write',
  }).access_token;
  autonomousAccessToken = tokensDao.mint({
    client_id: autonomousClientId,
    user_id: oauthUserId,
    scope: 'docs:read docs:write',
  }).access_token;

  app = express();
  app.use(express.json());

  // Create protected reviews router
  const protectedReviewsRouter = express.Router();
  protectedReviewsRouter.use('/reviews', requireAuth);
  protectedReviewsRouter.use(createReviewsRouter());
  app.use('/api', protectedReviewsRouter);
});

afterAll(() => {
  closeDb();
  try {
    unlinkSync(testDbPath);
  } catch {
    // ignore if already removed
  }
  delete process.env.FOUNDRY_DB_PATH;
});

describe('Reviews Router', () => {
  // ─── Authentication Tests ─────────────────────────────────────────
  
  describe('Authentication', () => {
    it('should return 401 when POST /reviews without token', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({ doc_path: 'test/doc.md' })
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 401 when POST /reviews with wrong token', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', 'Bearer wrong-token')
        .send({ doc_path: 'test/doc.md' })
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('should succeed when POST /reviews with valid token', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', 'Bearer test-token')
        .send({ doc_path: 'test/doc.md' })
        .expect(201);

      expect(res.body.id).toMatch(CUID2_REGEX);
    });
  });

  // ─── POST /reviews ─────────────────────────────────────────────────

  describe('POST /reviews', () => {
    it('should create a review with defaults', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'docs/process.md' })
        .expect(201);

      expect(res.body.id).toMatch(CUID2_REGEX);
      expect(res.body.doc_path).toBe('docs/process');
      // Legacy-token caller → req.user.id='legacy' (populated by S7 requireAuth).
      expect(res.body.user_id).toBe('legacy');
      expect(res.body.status).toBe('draft');
      expect(res.body.submitted_at).toBeNull();
      expect(res.body.completed_at).toBeNull();
      expect(res.body.created_at).toMatch(ISO_8601_REGEX);
      expect(res.body.updated_at).toMatch(ISO_8601_REGEX);
    });

    it('should return 400 when doc_path is missing', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({})
        .expect(400);

      expect(res.body.error).toContain('doc_path');
    });

    it('should return 400 when doc_path is empty string', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: '' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should generate unique IDs for each review', async () => {
      const res1 = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'docs/a.md' })
        .expect(201);

      const res2 = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'docs/b.md' })
        .expect(201);

      expect(res1.body.id).not.toBe(res2.body.id);
    });

    it('should allow multiple reviews for the same doc_path', async () => {
      const res1 = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'docs/same.md' })
        .expect(201);

      const res2 = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'docs/same.md' })
        .expect(201);

      expect(res1.body.id).not.toBe(res2.body.id);
      expect(res1.body.doc_path).toBe(res2.body.doc_path);
    });

    it('should set created_at and updated_at to the same value', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'docs/timestamps.md' })
        .expect(201);

      expect(res.body.created_at).toBe(res.body.updated_at);
    });
  });

  // ─── S8: Identity propagation (FND-E12-S8) ─────────────────────────

  describe('POST /reviews — S8 identity propagation', () => {
    // AC4 (reviews parity with annotations):
    // interactive OAuth → user_id=req.user.id (no author_type column on reviews)
    it('interactive OAuth client stamps user_id=req.user.id', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send({ doc_path: 'identity-reviews/interactive.md' })
        .expect(201);

      expect(res.body.user_id).toBe(oauthUserId);
    });

    // autonomous OAuth → user_id=req.user.id
    it('autonomous OAuth client stamps user_id=req.user.id', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${autonomousAccessToken}`)
        .send({ doc_path: 'identity-reviews/autonomous.md' })
        .expect(201);

      expect(res.body.user_id).toBe(oauthUserId);
    });

    // AC3/AC4: legacy Bearer → user_id='legacy'
    it('legacy Bearer caller stamps user_id=legacy', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', 'Bearer test-token')
        .send({ doc_path: 'identity-reviews/legacy.md' })
        .expect(201);

      expect(res.body.user_id).toBe('legacy');
    });

    // Server-authoritative: body user_id is silently dropped
    it('ignores user_id sent in the request body (server is authoritative)', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send({ doc_path: 'identity-reviews/spoof.md', user_id: 'attacker-id' })
        .expect(201);

      expect(res.body.user_id).toBe(oauthUserId);
      expect(res.body.user_id).not.toBe('attacker-id');
    });
  });

  // ─── GET /reviews ──────────────────────────────────────────────────

  describe('GET /reviews', () => {
    beforeAll(async () => {
      // Seed reviews for GET tests
      await request(app).post('/api/reviews').set("Authorization", "Bearer test-token").send({ doc_path: 'get-test/doc.md' }).expect(201);
      await request(app).post('/api/reviews').set("Authorization", "Bearer test-token").send({ doc_path: 'get-test/doc.md' }).expect(201);
      await request(app).post('/api/reviews').set("Authorization", "Bearer test-token").send({ doc_path: 'get-test/other.md' }).expect(201);
    });

    it('should return 400 when doc_path is missing', async () => {
      const res = await request(app)
        .get('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .expect(400);

      expect(res.body.error).toContain('doc_path');
    });

    it('should return reviews filtered by doc_path', async () => {
      const res = await request(app)
        .get('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      expect(res.body.length).toBe(2);
      for (const review of res.body) {
        expect(review.doc_path).toBe('get-test/doc');
      }
    });

    it('should return empty array for unknown doc_path', async () => {
      const res = await request(app)
        .get('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'non-existent/path.md' })
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return results ordered by created_at DESC', async () => {
      const res = await request(app)
        .get('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      const timestamps = res.body.map((r: any) => r.created_at);
      const sorted = [...timestamps].sort().reverse();
      expect(timestamps).toEqual(sorted);
    });

    it('should return all review fields', async () => {
      const res = await request(app)
        .get('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      const review = res.body[0];
      expect(review).toHaveProperty('id');
      expect(review).toHaveProperty('doc_path');
      expect(review).toHaveProperty('user_id');
      expect(review).toHaveProperty('status');
      expect(review).toHaveProperty('submitted_at');
      expect(review).toHaveProperty('completed_at');
      expect(review).toHaveProperty('created_at');
      expect(review).toHaveProperty('updated_at');
    });

    it('should only return reviews for the requested doc_path', async () => {
      const res = await request(app)
        .get('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/other.md' })
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].doc_path).toBe('get-test/other');
    });

    it('should filter reviews by status', async () => {
      // Create a review and update its status to submitted
      const created = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'status-test/doc.md' })
        .expect(201);

      await request(app)
        .patch(`/api/reviews/${created.body.id}`)
        .set("Authorization", "Bearer test-token")
        .send({ status: 'submitted', submitted_at: new Date().toISOString() })
        .expect(200);

      // Also create a draft review for the same doc
      await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'status-test/doc.md' })
        .expect(201);

      // Filter by submitted status
      const res = await request(app)
        .get('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'status-test/doc.md', status: 'submitted' })
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].status).toBe('submitted');
    });
  });

  // ─── GET /reviews/:id ───────────────────────────────────────────────

  describe('GET /reviews/:id', () => {
    it('should return 401 without auth', async () => {
      await request(app)
        .get('/api/reviews/some-id')
        .expect(401);
    });

    it('should return 404 for non-existent review', async () => {
      const res = await request(app)
        .get('/api/reviews/non-existent-id')
        .set("Authorization", "Bearer test-token")
        .expect(404);

      expect(res.body.error).toBe('Review not found');
    });

    it('should return review with empty annotations array', async () => {
      // Create a review
      const created = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'getbyid-test/doc.md' })
        .expect(201);

      const res = await request(app)
        .get(`/api/reviews/${created.body.id}`)
        .set("Authorization", "Bearer test-token")
        .expect(200);

      expect(res.body.review.id).toBe(created.body.id);
      expect(res.body.review.doc_path).toBe('getbyid-test/doc');
      expect(res.body.annotations).toEqual([]);
    });

    it('should return review with its annotations', async () => {
      // Create a review
      const created = await request(app)
        .post('/api/reviews')
        .set("Authorization", "Bearer test-token")
        .send({ doc_path: 'getbyid-ann/doc.md' })
        .expect(201);

      const reviewId = created.body.id;

      // Insert annotations directly into the DB
      const db = getDb();
      const now = new Date().toISOString();
      const insertStmt = db.prepare(`
        INSERT INTO annotations (id, doc_path, heading_path, content_hash, quoted_text, content, parent_id, review_id, user_id, author_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run('ann-1', 'getbyid-ann/doc.md', 'intro', '', null, 'First comment', null, reviewId, 'dan', 'human', 'submitted', now, now);
      insertStmt.run('ann-2', 'getbyid-ann/doc.md', 'conclusion', '', null, 'Second comment', null, reviewId, 'dan', 'human', 'submitted', now, now);

      const res = await request(app)
        .get(`/api/reviews/${reviewId}`)
        .set("Authorization", "Bearer test-token")
        .expect(200);

      expect(res.body.review.id).toBe(reviewId);
      expect(res.body.annotations).toHaveLength(2);
      expect(res.body.annotations[0].id).toBe('ann-1');
      expect(res.body.annotations[1].id).toBe('ann-2');
      expect(res.body.annotations[0].review_id).toBe(reviewId);
    });
  });
});
