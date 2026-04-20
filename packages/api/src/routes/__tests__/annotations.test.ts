import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { createAnnotationsRouter } from '../annotations.js';
import { createReviewsRouter } from '../reviews.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, tokensDao, usersDao } from '../../oauth/dao.js';

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CUID2_REGEX = /^[a-z0-9]{24,}$/;

let app: express.Express;
const testDbPath = join(tmpdir(), `foundry-test-annotations-${Date.now()}.db`);
const testContentDir = join(tmpdir(), `foundry-test-content-${Date.now()}`);

// OAuth test identities — populated in beforeAll so tests can mint tokens
// for interactive and autonomous clients to exercise S8 identity propagation.
let oauthUserId: string;
let interactiveClientId: string;
let autonomousClientId: string;
let interactiveAccessToken: string;
let autonomousAccessToken: string;

/** Create a stub markdown file in the test content directory */
function seedDoc(docPath: string): void {
  // docPath may include .md extension already — strip it to build the dir
  const withoutExt = docPath.replace(/\.md$/, '');
  const parts = withoutExt.split('/');
  const dir = join(testContentDir, ...parts.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(testContentDir, `${withoutExt}.md`), `# Test\n`, 'utf-8');
}

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  process.env.FOUNDRY_WRITE_TOKEN = 'test-token';
  process.env.CONTENT_DIR = testContentDir;
  // requireAuth needs FOUNDRY_OAUTH_ISSUER to emit WWW-Authenticate — set
  // a dummy value so OAuth paths in the test don't fail-loud on missing
  // config (WWW-Authenticate contents aren't asserted in this suite).
  process.env.FOUNDRY_OAUTH_ISSUER = process.env.FOUNDRY_OAUTH_ISSUER || 'https://foundry.test';

  // Seed all doc paths used by tests
  for (const docPath of [
    'docs/process.md',
    'get-test/doc.md',
    'get-test/other.md',
    'review-filter/doc.md',
    'getbyid-test/doc.md',
    'patch-test/doc.md',
    'delete-test/doc.md',
    'delete-cascade/doc.md',
    'delete-review/doc.md',
    'identity-test/doc.md',
  ]) {
    seedDoc(docPath);
  }

  // Seed OAuth identities + access tokens. The DB is opened lazily by
  // getDb() on first use; force it here so usersDao/clientsDao can write.
  getDb();

  const oauthUser = usersDao.upsert({ github_login: 'fern', github_id: 20202 });
  oauthUserId = oauthUser.id;

  const interactiveClient = clientsDao.register({
    name: 'Interactive Test Client',
    redirect_uris: 'https://example.com/cb',
    client_type: 'interactive',
  });
  interactiveClientId = interactiveClient.id;

  const autonomousClient = clientsDao.register({
    name: 'Autonomous Test Client',
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

  // Create protected annotations router
  const protectedAnnotationsRouter = express.Router();
  protectedAnnotationsRouter.use('/annotations', requireAuth);
  protectedAnnotationsRouter.use(createAnnotationsRouter());
  app.use('/api', protectedAnnotationsRouter);

  // Create protected reviews router (needed for orphan review cleanup tests)
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
  try {
    rmSync(testContentDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  delete process.env.FOUNDRY_DB_PATH;
  delete process.env.CONTENT_DIR;
});

// Helper to create a valid annotation body
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    doc_path: 'docs/process.md',
    heading_path: 'Purpose > Overview',
    content_hash: 'abc123',
    content: 'This section needs clarification.',
    ...overrides,
  };
}

describe('Annotations Router', () => {
  // ─── Authentication Tests ─────────────────────────────────────────
  
  describe('Authentication', () => {
    it('should return 401 when POST /annotations without token', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .send(validBody())
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 401 when GET /annotations without token', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .query({ doc_path: 'test/doc.md' })
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return 401 when POST /annotations with wrong token', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer wrong-token')
        .send(validBody())
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });

    it('should succeed when POST /annotations with valid token', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody())
        .expect(201);

      expect(res.body.id).toMatch(CUID2_REGEX);
    });

    it('should succeed when GET /annotations with valid token', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .query({ doc_path: 'test/doc.md' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ─── POST /annotations ─────────────────────────────────────────────

  describe('POST /annotations', () => {
    it('should create an annotation with defaults', async () => {
      const body = validBody();
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(body)
        .expect(201);

      expect(res.body.id).toMatch(CUID2_REGEX);
      expect(res.body.doc_path).toBe('docs/process');
      expect(res.body.heading_path).toBe(body.heading_path);
      expect(res.body.content_hash).toBe(body.content_hash);
      expect(res.body.content).toBe(body.content);
      expect(res.body.quoted_text).toBeNull();
      expect(res.body.parent_id).toBeNull();
      expect(res.body.review_id).toBeNull();
      // Legacy-token callers inherit req.user.id='legacy' and
      // req.client.client_type='autonomous' from S7, which maps to
      // author_type='ai'. Draft/submitted status derives from author_type.
      expect(res.body.user_id).toBe('legacy');
      expect(res.body.author_type).toBe('ai');
      expect(res.body.status).toBe('submitted');
      expect(res.body.created_at).toMatch(ISO_8601_REGEX);
      expect(res.body.updated_at).toMatch(ISO_8601_REGEX);
    });

    it('should accept optional quoted_text', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ quoted_text: 'some quoted text' }))
        .expect(201);

      expect(res.body.quoted_text).toBe('some quoted text');
    });

    it('derives author_type from client_type (legacy → autonomous → ai)', async () => {
      // Body author_type is ignored post-S8 — server derives from req.client.
      // Legacy token callers get client_type='autonomous' → author_type='ai'.
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ author_type: 'human' }))
        .expect(201);

      expect(res.body.author_type).toBe('ai');
    });

    it('defaults status to submitted for legacy (autonomous/ai) caller', async () => {
      // Legacy path → author_type='ai' → default status='submitted'.
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody())
        .expect(201);

      expect(res.body.status).toBe('submitted');
    });

    it('defaults status to draft for interactive (human) caller on top-level annotation', async () => {
      // Interactive OAuth client → author_type='human' → default status='draft'.
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send(validBody())
        .expect(201);

      expect(res.body.author_type).toBe('human');
      expect(res.body.status).toBe('draft');
    });

    it('defaults status to submitted for interactive reply (parent_id set)', async () => {
      // Replies always auto-submit regardless of author_type.
      const parent = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send(validBody())
        .expect(201);

      const reply = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send(validBody({ parent_id: parent.body.id, content: 'human reply' }))
        .expect(201);

      expect(reply.body.parent_id).toBe(parent.body.id);
      expect(reply.body.author_type).toBe('human');
      expect(reply.body.status).toBe('submitted');
    });

    it('defaults status to submitted for autonomous reply (ai + parent_id)', async () => {
      const parent = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send(validBody())
        .expect(201);

      const reply = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${autonomousAccessToken}`)
        .send(validBody({ parent_id: parent.body.id, content: 'ai reply' }))
        .expect(201);

      expect(reply.body.author_type).toBe('ai');
      expect(reply.body.status).toBe('submitted');
    });

    it('uses explicit status when provided, regardless of derived author_type', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ status: 'draft' }))
        .expect(201);

      expect(res.body.status).toBe('draft');
    });

    it('uses explicit status of replied when provided', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send(validBody({ status: 'replied' }))
        .expect(201);

      expect(res.body.status).toBe('replied');
    });

    it('should return 400 for invalid status value', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ status: 'invalid-status' }))
        .expect(400);

      expect(res.body.error).toContain('Invalid status');
    });

    it('should return 400 when doc_path is missing', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ doc_path: '' }))
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should return 400 when heading_path is missing', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ heading_path: '' }))
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should accept empty content_hash (optional — used for drift detection)', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ content_hash: '' }))
        .expect(201);

      expect(res.body.content_hash).toBe('');
    });

    it('should return 400 when content is missing', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ content: '' }))
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should return 400 with descriptive error message', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send({})
        .expect(400);

      expect(res.body.error).toContain('doc_path');
      expect(res.body.error).toContain('content');
    });

    it('should generate unique IDs for each annotation', async () => {
      const res1 = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody())
        .expect(201);

      const res2 = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody())
        .expect(201);

      expect(res1.body.id).not.toBe(res2.body.id);
    });
  });

  // ─── S8: Identity propagation (FND-E12-S8) ─────────────────────────

  describe('POST /annotations — S8 identity propagation', () => {
    // AC1: interactive client → author_type='human', user_id=req.user.id
    it('interactive OAuth client stamps author_type=human and user_id=req.user.id', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send(validBody({ doc_path: 'identity-test/doc.md', content: 'interactive comment' }))
        .expect(201);

      expect(res.body.author_type).toBe('human');
      expect(res.body.user_id).toBe(oauthUserId);
    });

    // AC2: autonomous client → author_type='ai', user_id=req.user.id
    it('autonomous OAuth client stamps author_type=ai and user_id=req.user.id', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${autonomousAccessToken}`)
        .send(validBody({ doc_path: 'identity-test/doc.md', content: 'autonomous comment' }))
        .expect(201);

      expect(res.body.author_type).toBe('ai');
      expect(res.body.user_id).toBe(oauthUserId);
    });

    // AC3: legacy Bearer → user_id='legacy', author_type='ai' (legacy is autonomous)
    it('legacy Bearer caller stamps user_id=legacy and author_type=ai', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'identity-test/doc.md', content: 'legacy comment' }))
        .expect(201);

      expect(res.body.user_id).toBe('legacy');
      expect(res.body.author_type).toBe('ai');
    });

    // Server-authoritative: body user_id is silently dropped
    it('ignores user_id sent in the request body (server is authoritative)', async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${interactiveAccessToken}`)
        .send(validBody({
          doc_path: 'identity-test/doc.md',
          content: 'spoofed body user_id',
          user_id: 'attacker-id',
        }))
        .expect(201);

      expect(res.body.user_id).toBe(oauthUserId);
      expect(res.body.user_id).not.toBe('attacker-id');
    });

    // Server-authoritative: body author_type is silently dropped
    it('ignores author_type sent in the request body (server is authoritative)', async () => {
      // Autonomous client trying to spoof 'human' → still gets 'ai'.
      const res = await request(app)
        .post('/api/annotations')
        .set('Authorization', `Bearer ${autonomousAccessToken}`)
        .send(validBody({
          doc_path: 'identity-test/doc.md',
          content: 'spoofed body author_type',
          author_type: 'human',
        }))
        .expect(201);

      expect(res.body.author_type).toBe('ai');
    });
  });

  // ─── GET /annotations ──────────────────────────────────────────────

  describe('GET /annotations', () => {
    // Seed some annotations for GET tests
    let seededIds: string[];

    beforeAll(async () => {
      // Post-S8, legacy-token callers default to author_type='ai' and status='submitted'.
      // We explicitly set status='draft' during seeding so the filter-by-status
      // test below can verify that exactly one 'submitted' annotation is returned
      // after we promote one of them via PATCH.
      const bodies = [
        validBody({ doc_path: 'get-test/doc.md', heading_path: 'Section A', content: 'note 1', status: 'draft' }),
        validBody({ doc_path: 'get-test/doc.md', heading_path: 'Section B', content: 'note 2', status: 'draft' }),
        validBody({ doc_path: 'get-test/doc.md', heading_path: 'Section A', content: 'note 3', quoted_text: 'quote', status: 'draft' }),
        validBody({ doc_path: 'get-test/other.md', heading_path: 'Intro', content: 'note 4', status: 'draft' }),
      ];

      seededIds = [];
      for (const body of bodies) {
        const res = await request(app).post('/api/annotations').set("Authorization", "Bearer test-token").send(body).expect(201);
        seededIds.push(res.body.id);
      }

      // Update one annotation status to 'submitted' for status filter testing
      await request(app)
        .patch(`/api/annotations/${seededIds[0]}`)
        .set("Authorization", "Bearer test-token")
        .send({ status: 'submitted' });
    });

    it('should return 400 when doc_path is missing', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .expect(400);

      expect(res.body.error).toContain('doc_path');
    });

    it('should return annotations filtered by doc_path', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      expect(res.body.length).toBe(3);
      for (const ann of res.body) {
        expect(ann.doc_path).toBe('get-test/doc');
      }
    });

    it('should return empty array for unknown doc_path', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'non-existent/path.md' })
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should filter by section (heading_path LIKE match)', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/doc.md', section: 'Section A' })
        .expect(200);

      expect(res.body.length).toBe(2);
      for (const ann of res.body) {
        expect(ann.heading_path).toContain('Section A');
      }
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/doc.md', status: 'submitted' })
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].status).toBe('submitted');
    });

    it('should combine section and status filters', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/doc.md', section: 'Section A', status: 'submitted' })
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].heading_path).toContain('Section A');
      expect(res.body[0].status).toBe('submitted');
    });

    it('should return results ordered by created_at DESC', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      const timestamps = res.body.map((a: any) => a.created_at);
      const sorted = [...timestamps].sort().reverse();
      expect(timestamps).toEqual(sorted);
    });
  });

  // ─── GET /annotations?review_id= ─────────────────────────────────

  describe('GET /annotations filtered by review_id', () => {
    let reviewId: string;

    beforeAll(async () => {
      // Create a review
      const review = await request(app)
        .post('/api/reviews')
        .set('Authorization', 'Bearer test-token')
        .send({ doc_path: 'review-filter/doc.md' })
        .expect(201);
      reviewId = review.body.id;

      // Create annotations with and without review_id. Post-S8 legacy callers
      // default to status='submitted', so explicitly set status='draft' here
      // so the combined review_id+status filter test finds exactly one
      // submitted annotation.
      await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'review-filter/doc.md', content: 'with review', review_id: reviewId, status: 'draft' }))
        .expect(201);

      const noReview = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'review-filter/doc.md', content: 'no review', status: 'draft' }))
        .expect(201);

      // Also create a submitted annotation with review_id for combined filter test
      const submitted = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'review-filter/doc.md', content: 'submitted with review', review_id: reviewId, status: 'draft' }))
        .expect(201);

      await request(app)
        .patch(`/api/annotations/${submitted.body.id}`)
        .set('Authorization', 'Bearer test-token')
        .send({ status: 'submitted' })
        .expect(200);
    });

    it('should filter annotations by review_id', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .query({ doc_path: 'review-filter/doc.md', review_id: reviewId })
        .expect(200);

      expect(res.body.length).toBe(2);
      for (const ann of res.body) {
        expect(ann.review_id).toBe(reviewId);
      }
    });

    it('should combine review_id and status filters', async () => {
      const res = await request(app)
        .get('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .query({ doc_path: 'review-filter/doc.md', review_id: reviewId, status: 'submitted' })
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].review_id).toBe(reviewId);
      expect(res.body[0].status).toBe('submitted');
    });
  });

  // ─── GET /annotations/:id ─────────────────────────────────────────

  describe('GET /annotations/:id', () => {
    let parentId: string;
    let replyId1: string;
    let replyId2: string;

    beforeAll(async () => {
      // Create a parent annotation
      const parentRes = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'getbyid-test/doc.md', content: 'parent annotation' }))
        .expect(201);
      parentId = parentRes.body.id;

      // Create replies with slight delay to ensure different created_at
      const reply1Res = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'getbyid-test/doc.md', content: 'first reply', parent_id: parentId }))
        .expect(201);
      replyId1 = reply1Res.body.id;

      await new Promise((r) => setTimeout(r, 10));

      const reply2Res = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'getbyid-test/doc.md', content: 'second reply', parent_id: parentId }))
        .expect(201);
      replyId2 = reply2Res.body.id;
    });

    it('should return annotation by ID with empty replies array', async () => {
      // Get a reply (which has no children)
      const res = await request(app)
        .get(`/api/annotations/${replyId1}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(res.body.annotation).toBeDefined();
      expect(res.body.annotation.id).toBe(replyId1);
      expect(res.body.annotation.content).toBe('first reply');
      expect(res.body.replies).toEqual([]);
    });

    it('should return annotation with replies sorted by created_at ASC', async () => {
      const res = await request(app)
        .get(`/api/annotations/${parentId}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(res.body.annotation).toBeDefined();
      expect(res.body.annotation.id).toBe(parentId);
      expect(res.body.annotation.content).toBe('parent annotation');
      expect(res.body.replies).toHaveLength(2);
      expect(res.body.replies[0].id).toBe(replyId1);
      expect(res.body.replies[1].id).toBe(replyId2);
      // Verify chronological order
      expect(res.body.replies[0].created_at <= res.body.replies[1].created_at).toBe(true);
    });

    it('should return 404 for non-existent annotation ID', async () => {
      const res = await request(app)
        .get('/api/annotations/nonexistent-id-99999')
        .set('Authorization', 'Bearer test-token')
        .expect(404);

      expect(res.body.error).toBe('Annotation not found');
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app)
        .get(`/api/annotations/${parentId}`)
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    });
  });

  // ─── PATCH /annotations/:id ────────────────────────────────────────

  describe('PATCH /annotations/:id', () => {
    let annotationId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .send(validBody({ doc_path: 'patch-test/doc.md', content: 'original content' }))
        .expect(201);
      annotationId = res.body.id;
    });

    it('should update status', async () => {
      const res = await request(app)
        .patch(`/api/annotations/${annotationId}`)
        .set("Authorization", "Bearer test-token")
        .send({ status: 'submitted' })
        .expect(200);

      expect(res.body.status).toBe('submitted');
      expect(res.body.id).toBe(annotationId);
    });

    it('should update content', async () => {
      const res = await request(app)
        .patch(`/api/annotations/${annotationId}`)
        .set("Authorization", "Bearer test-token")
        .send({ content: 'updated content' })
        .expect(200);

      expect(res.body.content).toBe('updated content');
    });

    it('should update both status and content', async () => {
      const res = await request(app)
        .patch(`/api/annotations/${annotationId}`)
        .set("Authorization", "Bearer test-token")
        .send({ status: 'resolved', content: 'final content' })
        .expect(200);

      expect(res.body.status).toBe('resolved');
      expect(res.body.content).toBe('final content');
    });

    it('should update updated_at timestamp', async () => {
      const before = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'patch-test/doc.md' })
        .expect(200);

      const originalUpdatedAt = before.body[0].updated_at;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      await request(app)
        .patch(`/api/annotations/${annotationId}`)
        .set("Authorization", "Bearer test-token")
        .send({ content: 'timestamp check' })
        .expect(200);

      const after = await request(app)
        .get('/api/annotations')
        .set("Authorization", "Bearer test-token")
        .query({ doc_path: 'patch-test/doc.md' })
        .expect(200);

      expect(after.body[0].updated_at).not.toBe(originalUpdatedAt);
      expect(after.body[0].updated_at).toMatch(ISO_8601_REGEX);
    });

    it('should return 400 when neither status nor content is provided', async () => {
      const res = await request(app)
        .patch(`/api/annotations/${annotationId}`)
        .set("Authorization", "Bearer test-token")
        .send({})
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should return 404 for non-existent annotation ID', async () => {
      const res = await request(app)
        .patch('/api/annotations/nonexistent-id-12345')
        .set("Authorization", "Bearer test-token")
        .send({ status: 'submitted' })
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });

  // ─── DELETE /annotations/:id ──────────────────────────────────────

  describe('DELETE /annotations/:id', () => {
    it('should delete a single annotation and return 204', async () => {
      const created = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'delete-test/doc.md', content: 'to be deleted' }))
        .expect(201);

      await request(app)
        .delete(`/api/annotations/${created.body.id}`)
        .set('Authorization', 'Bearer test-token')
        .expect(204);

      // Verify it's gone
      const list = await request(app)
        .get('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .query({ doc_path: 'delete-test/doc.md' })
        .expect(200);

      const ids = list.body.map((a: any) => a.id);
      expect(ids).not.toContain(created.body.id);
    });

    it('should cascade delete child replies', async () => {
      // Create parent
      const parent = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'delete-cascade/doc.md', content: 'parent' }))
        .expect(201);

      // Create children
      await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'delete-cascade/doc.md', content: 'child 1', parent_id: parent.body.id }))
        .expect(201);

      await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'delete-cascade/doc.md', content: 'child 2', parent_id: parent.body.id }))
        .expect(201);

      // Delete parent
      await request(app)
        .delete(`/api/annotations/${parent.body.id}`)
        .set('Authorization', 'Bearer test-token')
        .expect(204);

      // Verify all are gone
      const list = await request(app)
        .get('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .query({ doc_path: 'delete-cascade/doc.md' })
        .expect(200);

      expect(list.body).toHaveLength(0);
    });

    it('should clean up orphaned review when last annotation is deleted', async () => {
      // Create a review
      const review = await request(app)
        .post('/api/reviews')
        .set('Authorization', 'Bearer test-token')
        .send({ doc_path: 'delete-review/doc.md' })
        .expect(201);

      // Create annotation linked to review
      const ann = await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send(validBody({ doc_path: 'delete-review/doc.md', content: 'review comment', review_id: review.body.id }))
        .expect(201);

      // Patch annotation to set review_id (POST may not set it via body directly)
      await request(app)
        .patch(`/api/annotations/${ann.body.id}`)
        .set('Authorization', 'Bearer test-token')
        .send({ review_id: review.body.id })
        .expect(200);

      // Delete the annotation
      await request(app)
        .delete(`/api/annotations/${ann.body.id}`)
        .set('Authorization', 'Bearer test-token')
        .expect(204);

      // Verify review is also deleted
      const reviews = await request(app)
        .get('/api/reviews')
        .set('Authorization', 'Bearer test-token')
        .query({ doc_path: 'delete-review/doc.md' })
        .expect(200);

      const reviewIds = reviews.body.map((r: any) => r.id);
      expect(reviewIds).not.toContain(review.body.id);
    });

    it('should return 404 for non-existent annotation', async () => {
      await request(app)
        .delete('/api/annotations/nonexistent-id-99999')
        .set('Authorization', 'Bearer test-token')
        .expect(404);
    });

    it('should return 401 without auth token', async () => {
      await request(app)
        .delete('/api/annotations/any-id')
        .expect(401);
    });
  });
});
