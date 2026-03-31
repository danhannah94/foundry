import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import { createReviewsRouter } from '../reviews.js';
import { getDb, closeDb } from '../../db.js';

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CUID2_REGEX = /^[a-z0-9]{24,}$/;

let app: express.Express;
const testDbPath = join(tmpdir(), `foundry-test-reviews-${Date.now()}.db`);

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;

  app = express();
  app.use(express.json());
  app.use('/', createReviewsRouter());
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
  // ─── POST /reviews ─────────────────────────────────────────────────

  describe('POST /reviews', () => {
    it('should create a review with defaults', async () => {
      const res = await request(app)
        .post('/reviews')
        .send({ doc_path: 'docs/process.md' })
        .expect(201);

      expect(res.body.id).toMatch(CUID2_REGEX);
      expect(res.body.doc_path).toBe('docs/process.md');
      expect(res.body.user_id).toBe('dan');
      expect(res.body.status).toBe('draft');
      expect(res.body.submitted_at).toBeNull();
      expect(res.body.completed_at).toBeNull();
      expect(res.body.created_at).toMatch(ISO_8601_REGEX);
      expect(res.body.updated_at).toMatch(ISO_8601_REGEX);
    });

    it('should return 400 when doc_path is missing', async () => {
      const res = await request(app)
        .post('/reviews')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('doc_path');
    });

    it('should return 400 when doc_path is empty string', async () => {
      const res = await request(app)
        .post('/reviews')
        .send({ doc_path: '' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should generate unique IDs for each review', async () => {
      const res1 = await request(app)
        .post('/reviews')
        .send({ doc_path: 'docs/a.md' })
        .expect(201);

      const res2 = await request(app)
        .post('/reviews')
        .send({ doc_path: 'docs/b.md' })
        .expect(201);

      expect(res1.body.id).not.toBe(res2.body.id);
    });

    it('should allow multiple reviews for the same doc_path', async () => {
      const res1 = await request(app)
        .post('/reviews')
        .send({ doc_path: 'docs/same.md' })
        .expect(201);

      const res2 = await request(app)
        .post('/reviews')
        .send({ doc_path: 'docs/same.md' })
        .expect(201);

      expect(res1.body.id).not.toBe(res2.body.id);
      expect(res1.body.doc_path).toBe(res2.body.doc_path);
    });

    it('should set created_at and updated_at to the same value', async () => {
      const res = await request(app)
        .post('/reviews')
        .send({ doc_path: 'docs/timestamps.md' })
        .expect(201);

      expect(res.body.created_at).toBe(res.body.updated_at);
    });
  });

  // ─── GET /reviews ──────────────────────────────────────────────────

  describe('GET /reviews', () => {
    beforeAll(async () => {
      // Seed reviews for GET tests
      await request(app).post('/reviews').send({ doc_path: 'get-test/doc.md' }).expect(201);
      await request(app).post('/reviews').send({ doc_path: 'get-test/doc.md' }).expect(201);
      await request(app).post('/reviews').send({ doc_path: 'get-test/other.md' }).expect(201);
    });

    it('should return 400 when doc_path is missing', async () => {
      const res = await request(app)
        .get('/reviews')
        .expect(400);

      expect(res.body.error).toContain('doc_path');
    });

    it('should return reviews filtered by doc_path', async () => {
      const res = await request(app)
        .get('/reviews')
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      expect(res.body.length).toBe(2);
      for (const review of res.body) {
        expect(review.doc_path).toBe('get-test/doc.md');
      }
    });

    it('should return empty array for unknown doc_path', async () => {
      const res = await request(app)
        .get('/reviews')
        .query({ doc_path: 'non-existent/path.md' })
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return results ordered by created_at DESC', async () => {
      const res = await request(app)
        .get('/reviews')
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      const timestamps = res.body.map((r: any) => r.created_at);
      const sorted = [...timestamps].sort().reverse();
      expect(timestamps).toEqual(sorted);
    });

    it('should return all review fields', async () => {
      const res = await request(app)
        .get('/reviews')
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
        .get('/reviews')
        .query({ doc_path: 'get-test/other.md' })
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].doc_path).toBe('get-test/other.md');
    });
  });
});
