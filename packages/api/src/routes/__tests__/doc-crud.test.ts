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

    it('cascades: removes a parent section and all its descendant sections', async () => {
      // Seed a doc where ## Architecture has a ### Tech Stack child.
      // Deleting "## Architecture" should also remove "### Tech Stack".
      const docPath = 'cascade-test/parent-with-children';
      const filePath = seedDoc(
        docPath,
        [
          '# Doc',
          '',
          '## Overview',
          'overview prose',
          '',
          '## Architecture',
          'arch prose',
          '',
          '### Tech Stack',
          'tech prose',
          '',
          '### Data Flow',
          'flow prose',
          '',
          '## Roadmap',
          'roadmap prose',
        ].join('\n'),
      );

      const headingPath = encodeURIComponent('# Doc > ## Architecture');
      const res = await request(app)
        .delete(`/api/docs/${docPath}/sections/${headingPath}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      expect(res.body.deleted).toBe(true);

      // Read the file back and confirm Architecture and BOTH children are gone,
      // while Overview (sibling before) and Roadmap (sibling after) survive.
      const fs = await import('fs');
      const updated = fs.readFileSync(filePath, 'utf-8');
      expect(updated).toContain('## Overview');
      expect(updated).toContain('## Roadmap');
      expect(updated).not.toContain('## Architecture');
      expect(updated).not.toContain('### Tech Stack');
      expect(updated).not.toContain('### Data Flow');
      expect(updated).not.toContain('arch prose');
      expect(updated).not.toContain('tech prose');
      expect(updated).not.toContain('flow prose');
      // Sibling prose untouched
      expect(updated).toContain('overview prose');
      expect(updated).toContain('roadmap prose');
    });

    it('cascades: deleting a leaf section (no children) still works', async () => {
      // Edge case: subtreeEnd should equal bodyEnd when there are no children.
      const docPath = 'cascade-test/leaf';
      const filePath = seedDoc(
        docPath,
        [
          '# Doc',
          '',
          '## Keep Me',
          'keep prose',
          '',
          '### Sub To Delete',
          'sub prose',
          '',
          '## Also Keep',
          'also prose',
        ].join('\n'),
      );

      const headingPath = encodeURIComponent('# Doc > ## Keep Me > ### Sub To Delete');
      await request(app)
        .delete(`/api/docs/${docPath}/sections/${headingPath}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      const fs = await import('fs');
      const updated = fs.readFileSync(filePath, 'utf-8');
      expect(updated).toContain('## Keep Me');
      expect(updated).toContain('keep prose');
      expect(updated).toContain('## Also Keep');
      expect(updated).not.toContain('### Sub To Delete');
      expect(updated).not.toContain('sub prose');
    });

    it('cascades: deleting the last top-level section removes everything to EOF', async () => {
      // Edge case: subtreeEnd should be lines.length when no following
      // sibling/parent exists.
      const docPath = 'cascade-test/last-section';
      const filePath = seedDoc(
        docPath,
        [
          '# Doc',
          '',
          '## First',
          'first prose',
          '',
          '## Last',
          'last prose',
          '',
          '### Last Child',
          'child prose',
        ].join('\n'),
      );

      const headingPath = encodeURIComponent('# Doc > ## Last');
      await request(app)
        .delete(`/api/docs/${docPath}/sections/${headingPath}`)
        .set('Authorization', 'Bearer test-token')
        .expect(200);

      const fs = await import('fs');
      const updated = fs.readFileSync(filePath, 'utf-8');
      expect(updated).toContain('## First');
      expect(updated).toContain('first prose');
      expect(updated).not.toContain('## Last');
      expect(updated).not.toContain('### Last Child');
      expect(updated).not.toContain('last prose');
      expect(updated).not.toContain('child prose');
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

describe('update_section — subtree replacement', () => {
  it('replaces body AND descendant sections when updating a parent', async () => {
    const docPath = 'subtree-test/replace-children';
    const filePath = seedDoc(docPath, [
      '# Doc',
      '',
      '## Parent',
      'old parent prose',
      '',
      '### Child A',
      'old child a',
      '',
      '### Child B',
      'old child b',
      '',
      '## Sibling',
      'sibling prose',
    ].join('\n'));

    const headingPath = encodeURIComponent('# Doc > ## Parent');
    const res = await request(app)
      .put(`/api/docs/${docPath}/sections/${headingPath}`)
      .set('Authorization', 'Bearer test-token')
      .send({ content: 'new parent prose\n\n### New Child\nnew child content' })
      .expect(200);

    expect(res.body.updated).toBe(true);

    const fs = await import('fs');
    const updated = fs.readFileSync(filePath, 'utf-8');
    // New content is present
    expect(updated).toContain('new parent prose');
    expect(updated).toContain('### New Child');
    expect(updated).toContain('new child content');
    // Old children are gone
    expect(updated).not.toContain('### Child A');
    expect(updated).not.toContain('### Child B');
    expect(updated).not.toContain('old child a');
    expect(updated).not.toContain('old child b');
    // Sibling is untouched
    expect(updated).toContain('## Sibling');
    expect(updated).toContain('sibling prose');
  });

  it('replaces H1 body and all children when updating the top-level heading', async () => {
    const docPath = 'subtree-test/h1-replace';
    const filePath = seedDoc(docPath, [
      '# Doc Title',
      'old intro',
      '',
      '## Section A',
      'section a content',
      '',
      '## Section B',
      'section b content',
    ].join('\n'));

    const headingPath = encodeURIComponent('# Doc Title');
    await request(app)
      .put(`/api/docs/${docPath}/sections/${headingPath}`)
      .set('Authorization', 'Bearer test-token')
      .send({ content: 'completely new body\n\n## New Only Section\nnew section content' })
      .expect(200);

    const fs = await import('fs');
    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).toContain('# Doc Title');
    expect(updated).toContain('completely new body');
    expect(updated).toContain('## New Only Section');
    expect(updated).not.toContain('## Section A');
    expect(updated).not.toContain('## Section B');
  });
});

describe('create_doc — content parameter', () => {
  it('creates a doc with custom content when content param is provided', async () => {
    const docPath = 'content-test/custom';
    const customContent = '# Custom Doc\n\n## My Section\nmy content here';

    const res = await request(app)
      .post('/api/docs')
      .set('Authorization', 'Bearer test-token')
      .send({ path: docPath, template: 'blank', title: 'Custom Doc', content: customContent })
      .expect(201);

    expect(res.body.created).toBe(true);

    const fs = await import('fs');
    const filePath = join(testContentDir, `${docPath}.md`);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe(customContent);
  });

  it('falls back to template when content is not provided', async () => {
    const docPath = 'content-test/template-fallback';

    const res = await request(app)
      .post('/api/docs')
      .set('Authorization', 'Bearer test-token')
      .send({ path: docPath, template: 'blank', title: 'Blank Doc' })
      .expect(201);

    const fs = await import('fs');
    const filePath = join(testContentDir, `${docPath}.md`);
    const written = fs.readFileSync(filePath, 'utf-8');
    expect(written).toBe('# Blank Doc\n');
  });
});

describe('insert_section — ordering', () => {
  it('sequential inserts after the same heading insert at subtreeEnd each time', async () => {
    const docPath = 'fifo-test/ordering';
    const filePath = seedDoc(docPath, [
      '# Doc',
      '',
      '## Anchor',
      'anchor content',
    ].join('\n'));

    const afterHeading = '# Doc > ## Anchor';

    // Insert First, then Second, both after ## Anchor
    await request(app)
      .post(`/api/docs/${docPath}/sections`)
      .set('Authorization', 'Bearer test-token')
      .send({ after_heading: afterHeading, heading: 'First', level: 2, content: 'first body' })
      .expect(201);

    await request(app)
      .post(`/api/docs/${docPath}/sections`)
      .set('Authorization', 'Bearer test-token')
      .send({ after_heading: afterHeading, heading: 'Second', level: 2, content: 'second body' })
      .expect(201);

    const fs = await import('fs');
    const updated = fs.readFileSync(filePath, 'utf-8');
    const firstIdx = updated.indexOf('## First');
    const secondIdx = updated.indexOf('## Second');
    // Both inserted; Second appears immediately after Anchor (at subtreeEnd),
    // pushing First further down
    expect(secondIdx).toBeLessThan(firstIdx);
    expect(secondIdx).toBeGreaterThan(-1);
  });
});

describe('move_section', () => {
  it('moves a section after another section', async () => {
    const docPath = 'move-test/basic';
    const filePath = seedDoc(docPath, [
      '# Doc',
      '',
      '## A',
      'a content',
      '',
      '## B',
      'b content',
      '',
      '## C',
      'c content',
    ].join('\n'));

    // Move A after C
    const res = await request(app)
      .post(`/api/docs/${docPath}/sections/move`)
      .set('Authorization', 'Bearer test-token')
      .send({ heading: '# Doc > ## A', after_heading: '# Doc > ## C' })
      .expect(200);

    expect(res.body.moved).toBe(true);

    const fs = await import('fs');
    const updated = fs.readFileSync(filePath, 'utf-8');
    const bIdx = updated.indexOf('## B');
    const cIdx = updated.indexOf('## C');
    const aIdx = updated.indexOf('## A');
    // Order should be B, C, A
    expect(bIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(aIdx);
  });

  it('moves a section with descendants (entire subtree moves)', async () => {
    const docPath = 'move-test/with-children';
    const filePath = seedDoc(docPath, [
      '# Doc',
      '',
      '## Parent',
      'parent prose',
      '',
      '### Child',
      'child prose',
      '',
      '## Target',
      'target prose',
    ].join('\n'));

    await request(app)
      .post(`/api/docs/${docPath}/sections/move`)
      .set('Authorization', 'Bearer test-token')
      .send({ heading: '# Doc > ## Parent', after_heading: '# Doc > ## Target' })
      .expect(200);

    const fs = await import('fs');
    const updated = fs.readFileSync(filePath, 'utf-8');
    const targetIdx = updated.indexOf('## Target');
    const parentIdx = updated.indexOf('## Parent');
    const childIdx = updated.indexOf('### Child');
    // Target first, then Parent with its Child
    expect(targetIdx).toBeLessThan(parentIdx);
    expect(parentIdx).toBeLessThan(childIdx);
    expect(updated).toContain('child prose');
  });

  it('returns 400 when moving a section after itself', async () => {
    seedDoc('move-test/self', '# Doc\n\n## A\ncontent');

    const res = await request(app)
      .post('/api/docs/move-test/self/sections/move')
      .set('Authorization', 'Bearer test-token')
      .send({ heading: '# Doc > ## A', after_heading: '# Doc > ## A' })
      .expect(400);

    expect(res.body.error).toMatch(/itself/i);
  });

  it('returns 404 with available_headings when source not found', async () => {
    seedDoc('move-test/missing', '# Doc\n\n## A\ncontent');

    const res = await request(app)
      .post('/api/docs/move-test/missing/sections/move')
      .set('Authorization', 'Bearer test-token')
      .send({ heading: '## Nope', after_heading: '# Doc > ## A' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
    expect(Array.isArray(res.body.available_headings)).toBe(true);
  });
});

describe('submit_review user_id attribution', () => {
  // Post-S8 (FND-E12-S8): server derives user_id from req.user, ignoring
  // any user_id in the body. Legacy Bearer callers get user_id='legacy'.
  it('POST /api/reviews stamps user_id from req.user and ignores body user_id', async () => {
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

    // Body user_id='clay' is silently dropped; legacy token → user_id='legacy'.
    expect(res.body.user_id).toBe('legacy');
  });
});
