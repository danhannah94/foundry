import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import { createAnnotationsRouter } from '../annotations.js';
import { getDb, closeDb } from '../../db.js';

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CUID2_REGEX = /^[a-z0-9]{24,}$/;

let app: express.Express;
const testDbPath = join(tmpdir(), `foundry-test-annotations-${Date.now()}.db`);

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;

  app = express();
  app.use(express.json());
  app.use('/', createAnnotationsRouter());
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
  // ─── POST /annotations ─────────────────────────────────────────────

  describe('POST /annotations', () => {
    it('should create an annotation with defaults', async () => {
      const body = validBody();
      const res = await request(app)
        .post('/annotations')
        .send(body)
        .expect(201);

      expect(res.body.id).toMatch(CUID2_REGEX);
      expect(res.body.doc_path).toBe(body.doc_path);
      expect(res.body.heading_path).toBe(body.heading_path);
      expect(res.body.content_hash).toBe(body.content_hash);
      expect(res.body.content).toBe(body.content);
      expect(res.body.quoted_text).toBeNull();
      expect(res.body.parent_id).toBeNull();
      expect(res.body.review_id).toBeNull();
      expect(res.body.user_id).toBe('dan');
      expect(res.body.author_type).toBe('human');
      expect(res.body.status).toBe('draft');
      expect(res.body.created_at).toMatch(ISO_8601_REGEX);
      expect(res.body.updated_at).toMatch(ISO_8601_REGEX);
    });

    it('should accept optional quoted_text', async () => {
      const res = await request(app)
        .post('/annotations')
        .send(validBody({ quoted_text: 'some quoted text' }))
        .expect(201);

      expect(res.body.quoted_text).toBe('some quoted text');
    });

    it('should accept optional author_type of ai', async () => {
      const res = await request(app)
        .post('/annotations')
        .send(validBody({ author_type: 'ai' }))
        .expect(201);

      expect(res.body.author_type).toBe('ai');
    });

    it('should return 400 when doc_path is missing', async () => {
      const res = await request(app)
        .post('/annotations')
        .send(validBody({ doc_path: '' }))
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should return 400 when heading_path is missing', async () => {
      const res = await request(app)
        .post('/annotations')
        .send(validBody({ heading_path: '' }))
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should return 400 when content_hash is missing', async () => {
      const res = await request(app)
        .post('/annotations')
        .send(validBody({ content_hash: '' }))
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should return 400 when content is missing', async () => {
      const res = await request(app)
        .post('/annotations')
        .send(validBody({ content: '' }))
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should return 400 with descriptive error message', async () => {
      const res = await request(app)
        .post('/annotations')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('doc_path');
      expect(res.body.error).toContain('content');
    });

    it('should generate unique IDs for each annotation', async () => {
      const res1 = await request(app)
        .post('/annotations')
        .send(validBody())
        .expect(201);

      const res2 = await request(app)
        .post('/annotations')
        .send(validBody())
        .expect(201);

      expect(res1.body.id).not.toBe(res2.body.id);
    });
  });

  // ─── GET /annotations ──────────────────────────────────────────────

  describe('GET /annotations', () => {
    // Seed some annotations for GET tests
    let seededIds: string[];

    beforeAll(async () => {
      const bodies = [
        validBody({ doc_path: 'get-test/doc.md', heading_path: 'Section A', content: 'note 1' }),
        validBody({ doc_path: 'get-test/doc.md', heading_path: 'Section B', content: 'note 2' }),
        validBody({ doc_path: 'get-test/doc.md', heading_path: 'Section A', content: 'note 3', quoted_text: 'quote' }),
        validBody({ doc_path: 'get-test/other.md', heading_path: 'Intro', content: 'note 4' }),
      ];

      seededIds = [];
      for (const body of bodies) {
        const res = await request(app).post('/annotations').send(body).expect(201);
        seededIds.push(res.body.id);
      }

      // Update one annotation status to 'submitted' for status filter testing
      await request(app)
        .patch(`/annotations/${seededIds[0]}`)
        .send({ status: 'submitted' });
    });

    it('should return 400 when doc_path is missing', async () => {
      const res = await request(app)
        .get('/annotations')
        .expect(400);

      expect(res.body.error).toContain('doc_path');
    });

    it('should return annotations filtered by doc_path', async () => {
      const res = await request(app)
        .get('/annotations')
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      expect(res.body.length).toBe(3);
      for (const ann of res.body) {
        expect(ann.doc_path).toBe('get-test/doc.md');
      }
    });

    it('should return empty array for unknown doc_path', async () => {
      const res = await request(app)
        .get('/annotations')
        .query({ doc_path: 'non-existent/path.md' })
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should filter by section (heading_path LIKE match)', async () => {
      const res = await request(app)
        .get('/annotations')
        .query({ doc_path: 'get-test/doc.md', section: 'Section A' })
        .expect(200);

      expect(res.body.length).toBe(2);
      for (const ann of res.body) {
        expect(ann.heading_path).toContain('Section A');
      }
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get('/annotations')
        .query({ doc_path: 'get-test/doc.md', status: 'submitted' })
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].status).toBe('submitted');
    });

    it('should combine section and status filters', async () => {
      const res = await request(app)
        .get('/annotations')
        .query({ doc_path: 'get-test/doc.md', section: 'Section A', status: 'submitted' })
        .expect(200);

      expect(res.body.length).toBe(1);
      expect(res.body[0].heading_path).toContain('Section A');
      expect(res.body[0].status).toBe('submitted');
    });

    it('should return results ordered by created_at DESC', async () => {
      const res = await request(app)
        .get('/annotations')
        .query({ doc_path: 'get-test/doc.md' })
        .expect(200);

      const timestamps = res.body.map((a: any) => a.created_at);
      const sorted = [...timestamps].sort().reverse();
      expect(timestamps).toEqual(sorted);
    });
  });

  // ─── PATCH /annotations/:id ────────────────────────────────────────

  describe('PATCH /annotations/:id', () => {
    let annotationId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post('/annotations')
        .send(validBody({ doc_path: 'patch-test/doc.md', content: 'original content' }))
        .expect(201);
      annotationId = res.body.id;
    });

    it('should update status', async () => {
      const res = await request(app)
        .patch(`/annotations/${annotationId}`)
        .send({ status: 'submitted' })
        .expect(200);

      expect(res.body.status).toBe('submitted');
      expect(res.body.id).toBe(annotationId);
    });

    it('should update content', async () => {
      const res = await request(app)
        .patch(`/annotations/${annotationId}`)
        .send({ content: 'updated content' })
        .expect(200);

      expect(res.body.content).toBe('updated content');
    });

    it('should update both status and content', async () => {
      const res = await request(app)
        .patch(`/annotations/${annotationId}`)
        .send({ status: 'resolved', content: 'final content' })
        .expect(200);

      expect(res.body.status).toBe('resolved');
      expect(res.body.content).toBe('final content');
    });

    it('should update updated_at timestamp', async () => {
      const before = await request(app)
        .get('/annotations')
        .query({ doc_path: 'patch-test/doc.md' })
        .expect(200);

      const originalUpdatedAt = before.body[0].updated_at;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      await request(app)
        .patch(`/annotations/${annotationId}`)
        .send({ content: 'timestamp check' })
        .expect(200);

      const after = await request(app)
        .get('/annotations')
        .query({ doc_path: 'patch-test/doc.md' })
        .expect(200);

      expect(after.body[0].updated_at).not.toBe(originalUpdatedAt);
      expect(after.body[0].updated_at).toMatch(ISO_8601_REGEX);
    });

    it('should return 400 when neither status nor content is provided', async () => {
      const res = await request(app)
        .patch(`/annotations/${annotationId}`)
        .send({})
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('should return 404 for non-existent annotation ID', async () => {
      const res = await request(app)
        .patch('/annotations/nonexistent-id-12345')
        .send({ status: 'submitted' })
        .expect(404);

      expect(res.body.error).toContain('not found');
    });
  });
});
