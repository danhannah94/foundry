import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  rmSync,
} from 'fs';

// Mock index.js to avoid triggering startServer() on import. doc-crud.ts
// imports { invalidateContent } from '../index.js' which (in real runs)
// also boots the Express server. In tests we just stub it.
vi.mock('../../index.js', () => ({
  invalidateContent: vi.fn(async () => {}),
}));

import { createDocCrudRouter } from '../doc-crud.js';
import { createAnnotationsRouter } from '../annotations.js';
import { requireAuth } from '../../middleware/auth.js';
import { getDb, closeDb } from '../../db.js';

const testDbPath = join(tmpdir(), `foundry-test-doc-crud-${Date.now()}.db`);
const testContentDir = join(tmpdir(), `foundry-test-doc-crud-content-${Date.now()}`);

let app: express.Express;

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  process.env.FOUNDRY_WRITE_TOKEN = 'test-token';
  process.env.CONTENT_DIR = testContentDir;

  mkdirSync(testContentDir, { recursive: true });

  app = express();
  app.use(express.json());
  app.use('/api', createDocCrudRouter());

  // Mount annotations router so we can seed annotations for delete_doc tests
  const protectedAnnotations = express.Router();
  protectedAnnotations.use('/annotations', requireAuth);
  protectedAnnotations.use(createAnnotationsRouter());
  app.use('/api', protectedAnnotations);
});

afterAll(() => {
  closeDb();
  try {
    unlinkSync(testDbPath);
  } catch {}
  try {
    rmSync(testContentDir, { recursive: true, force: true });
  } catch {}
  delete process.env.FOUNDRY_DB_PATH;
  delete process.env.CONTENT_DIR;
});

/**
 * Write a markdown file to the test content dir and insert a docs_meta row.
 * Mirrors what POST /api/docs does, without going through that route.
 */
function seedDoc(docPath: string, content: string): string {
  const filePath = join(testContentDir, `${docPath}.md`);
  mkdirSync(join(testContentDir, ...docPath.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');

  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO docs_meta (path, title, access, content_hash, modified_at, modified_by, created_at)
    VALUES (?, ?, 'public', 'testhash', ?, 'test', ?)
  `).run(docPath, docPath, now, now);

  return filePath;
}

describe('Doc CRUD Router — strict error contract', () => {
  const SAMPLE = [
    '# Doc Title',
    '',
    '## Overview',
    'overview body',
    '',
    '## Architecture',
    '',
    '### Tech Stack',
    'tech body',
  ].join('\n');

  beforeEach(() => {
    // Reset the sample doc for each test
    seedDoc('test-strict/sample', SAMPLE);
  });

  describe('update_section', () => {
    it('returns 404 with available_headings when heading_path does not exist', async () => {
      const res = await request(app)
        .put('/api/docs/test-strict/sample/sections/%23%23%20Nope')
        .set('Authorization', 'Bearer test-token')
        .send({ content: 'new body' })
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
      expect(Array.isArray(res.body.available_headings)).toBe(true);
      expect(res.body.available_headings).toContain('# Doc Title');
      expect(res.body.available_headings).toContain('# Doc Title > ## Overview');
      expect(res.body.available_headings).toContain(
        '# Doc Title > ## Architecture > ### Tech Stack'
      );
    });

    it('updates an existing section by canonical heading path', async () => {
      const headingPath = encodeURIComponent('# Doc Title > ## Overview');
      const res = await request(app)
        .put(`/api/docs/test-strict/sample/sections/${headingPath}`)
        .set('Authorization', 'Bearer test-token')
        .send({ content: 'replaced overview' })
        .expect(200);

      expect(res.body.updated).toBe(true);
    });
  });

  describe('insert_section', () => {
    it('returns 404 with available_headings when after_heading does not exist', async () => {
      const res = await request(app)
        .post('/api/docs/test-strict/sample/sections')
        .set('Authorization', 'Bearer test-token')
        .send({
          after_heading: '## Does Not Exist',
          heading: 'New Section',
          level: 2,
          content: 'hi',
        })
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
      expect(Array.isArray(res.body.available_headings)).toBe(true);
      expect(res.body.available_headings).toContain('# Doc Title > ## Overview');
    });
  });

  describe('delete_section', () => {
    it('returns 404 with available_headings when heading_path does not exist', async () => {
      const res = await request(app)
        .delete('/api/docs/test-strict/sample/sections/%23%23%20Nonexistent')
        .set('Authorization', 'Bearer test-token')
        .expect(404);

      expect(res.body.error).toMatch(/not found/i);
      expect(Array.isArray(res.body.available_headings)).toBe(true);
      expect(res.body.available_headings.length).toBeGreaterThan(0);
    });
  });
});

describe('DELETE /api/docs/:path — delete_doc', () => {
  it('hard-deletes an existing doc: file + docs_meta + annotations gone', async () => {
    const docPath = 'delete-doc-test/happy';
    const filePath = seedDoc(docPath, '# Happy\n\n## Overview\nbody');

    // Seed a few annotations on the doc
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/annotations')
        .set('Authorization', 'Bearer test-token')
        .send({
          doc_path: docPath,
          heading_path: '## Overview',
          content_hash: 'abc',
          content: `annotation ${i}`,
        })
        .expect(201);
    }

    // Sanity: annotations exist
    const db = getDb();
    const preCount = db
      .prepare('SELECT COUNT(*) as c FROM annotations WHERE doc_path = ?')
      .get(docPath) as { c: number };
    expect(preCount.c).toBe(3);

    const res = await request(app)
      .delete(`/api/docs/${docPath}`)
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    expect(res.body.deleted).toBe(true);
    expect(res.body.path).toBe(docPath);
    expect(res.body.annotations_deleted).toBe(3);

    // File is gone
    expect(existsSync(filePath)).toBe(false);

    // docs_meta row is gone
    const metaRow = db.prepare('SELECT path FROM docs_meta WHERE path = ?').get(docPath);
    expect(metaRow).toBeUndefined();

    // Annotations are gone
    const postCount = db
      .prepare('SELECT COUNT(*) as c FROM annotations WHERE doc_path = ?')
      .get(docPath) as { c: number };
    expect(postCount.c).toBe(0);
  });

  it('returns 404 for a missing doc', async () => {
    const res = await request(app)
      .delete('/api/docs/delete-doc-test/does-not-exist')
      .set('Authorization', 'Bearer test-token')
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 200 with annotations_deleted: 0 for a doc with no annotations', async () => {
    const docPath = 'delete-doc-test/lonely';
    const filePath = seedDoc(docPath, '# Lonely\n');

    const res = await request(app)
      .delete(`/api/docs/${docPath}`)
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    expect(res.body.deleted).toBe(true);
    expect(res.body.annotations_deleted).toBe(0);
    expect(existsSync(filePath)).toBe(false);
  });

  it('returns 401 without auth token', async () => {
    await request(app)
      .delete('/api/docs/anything')
      .expect(401);
  });
});

describe('submit_review user_id attribution', () => {
  // This test validates that /api/reviews accepts user_id from the body
  // (the submitReview http-client helper now passes it). We test the route
  // directly here, since the http-client is exercised end-to-end via MCP.
  it('POST /api/reviews accepts user_id from body', async () => {
    // Mount reviews router on its own app so we don't depend on router order
    const reviewsApp = express();
    reviewsApp.use(express.json());
    const { createReviewsRouter } = await import('../reviews.js');
    const protectedReviews = express.Router();
    protectedReviews.use('/reviews', requireAuth);
    protectedReviews.use(createReviewsRouter());
    reviewsApp.use('/api', protectedReviews);

    const res = await request(reviewsApp)
      .post('/api/reviews')
      .set('Authorization', 'Bearer test-token')
      .send({ doc_path: 'user-attribution/test', user_id: 'clay' })
      .expect(201);

    expect(res.body.user_id).toBe('clay');
  });
});
