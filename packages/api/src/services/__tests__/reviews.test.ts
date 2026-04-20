/**
 * Service-level unit tests for reviewsService.
 *
 * Focus: identity propagation on create, validation errors, and the
 * submit() flow that composes list + patch across annotations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import * as reviewsService from '../reviews.js';
import * as annotationsService from '../annotations.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { getDb, closeDb } from '../../db.js';
import type { AuthContext } from '../context.js';

const testDbPath = join(tmpdir(), `foundry-svc-reviews-${Date.now()}.db`);
const testContentDir = join(tmpdir(), `foundry-svc-reviews-content-${Date.now()}`);

function seedDoc(relPath: string): void {
  const withoutExt = relPath.replace(/\.md$/, '');
  const parts = withoutExt.split('/');
  const dir = join(testContentDir, ...parts.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(testContentDir, `${withoutExt}.md`), `# Test\n`, 'utf-8');
}

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  process.env.CONTENT_DIR = testContentDir;
  mkdirSync(testContentDir, { recursive: true });
  seedDoc('svc/reviews-tests.md');
  getDb();
});

afterAll(() => {
  closeDb();
  try { unlinkSync(testDbPath); } catch {}
  try { rmSync(testContentDir, { recursive: true, force: true }); } catch {}
  delete process.env.FOUNDRY_DB_PATH;
  delete process.env.CONTENT_DIR;
});

const ctx: AuthContext = {
  user: { id: 'u1', github_login: 'alice', scopes: ['docs:read', 'docs:write'] },
  client: { id: 'c1', name: 'Alice', client_type: 'interactive' },
};

describe('reviewsService', () => {
  describe('create', () => {
    it('stamps user_id from ctx.user.id', async () => {
      const review = await reviewsService.create(ctx, { doc_path: 'svc/reviews-tests' });
      expect(review.user_id).toBe('u1');
      expect(review.status).toBe('draft');
    });

    it('falls back to anonymous when ctx empty', async () => {
      const review = await reviewsService.create({}, { doc_path: 'svc/reviews-tests' });
      expect(review.user_id).toBe('anonymous');
    });

    it('throws ValidationError when doc_path missing', async () => {
      await expect(
        reviewsService.create(ctx, { doc_path: '' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('get / list / edit', () => {
    it('get throws NotFoundError for unknown id', async () => {
      await expect(
        reviewsService.get(ctx, { id: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('list returns reviews for a doc', async () => {
      await reviewsService.create(ctx, { doc_path: 'svc/reviews-tests' });
      const rows = await reviewsService.list(ctx, { doc_path: 'svc/reviews-tests' });
      expect(rows.length).toBeGreaterThan(0);
    });

    it('edit requires at least one mutable field', async () => {
      await expect(
        reviewsService.edit(ctx, { id: 'any' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('submit', () => {
    it('creates a review and attaches draft annotations to it', async () => {
      // Seed some annotations
      const a1 = await annotationsService.create(ctx, {
        doc_path: 'svc/reviews-tests',
        heading_path: 'S1',
        content: 'first',
      });
      const a2 = await annotationsService.create(ctx, {
        doc_path: 'svc/reviews-tests',
        heading_path: 'S2',
        content: 'second',
      });

      const result = await reviewsService.submit(ctx, {
        doc_path: 'svc/reviews-tests',
        annotation_ids: [a1.annotation.id, a2.annotation.id],
      });

      expect(result.status).toBe('review_submitted');
      expect(result.review_id).toBeTruthy();
      expect(result.comment_count).toBe(2);

      // Verify annotations got review_id stamped and status=submitted
      const updated = await annotationsService.get(ctx, { id: a1.annotation.id });
      expect(updated.annotation.review_id).toBe(result.review_id);
      expect(updated.annotation.status).toBe('submitted');

      // Verify review ended up status=submitted
      const review = await reviewsService.get(ctx, { id: result.review_id });
      expect(review.review.status).toBe('submitted');
      expect(review.review.submitted_at).toBeTruthy();
    });
  });
});
