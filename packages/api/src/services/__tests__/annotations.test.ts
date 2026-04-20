/**
 * Service-level unit tests for annotationsService.
 *
 * These tests exercise the domain logic directly — no supertest, no
 * HTTP layer. HTTP contract is covered by routes/__tests__/annotations.test.ts.
 * We focus on identity propagation, validation edge cases, and the
 * domain-level errors the MCP tool handler (S10b) will want to observe.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import * as annotationsService from '../annotations.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { getDb, closeDb } from '../../db.js';
import type { AuthContext } from '../context.js';

const testDbPath = join(tmpdir(), `foundry-svc-annotations-${Date.now()}.db`);
const testContentDir = join(tmpdir(), `foundry-svc-annotations-content-${Date.now()}`);

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
  seedDoc('svc/annotations-tests.md');
  getDb();
});

afterAll(() => {
  closeDb();
  try { unlinkSync(testDbPath); } catch {}
  try { rmSync(testContentDir, { recursive: true, force: true }); } catch {}
  delete process.env.FOUNDRY_DB_PATH;
  delete process.env.CONTENT_DIR;
});

function interactiveCtx(): AuthContext {
  return {
    user: { id: 'u1', github_login: 'alice', scopes: ['docs:read', 'docs:write'] },
    client: { id: 'c1', name: 'Alice Browser', client_type: 'interactive' },
  };
}

function autonomousCtx(): AuthContext {
  return {
    user: { id: 'u2', github_login: 'bot', scopes: ['docs:read', 'docs:write'] },
    client: { id: 'c2', name: 'Some Bot', client_type: 'autonomous' },
  };
}

describe('annotationsService', () => {
  describe('create', () => {
    it('stamps user_id from ctx.user.id', async () => {
      const ctx = interactiveCtx();
      const { annotation } = await annotationsService.create(ctx, {
        doc_path: 'svc/annotations-tests',
        heading_path: 'Test',
        content: 'Identity stamping test.',
      });
      expect(annotation.user_id).toBe('u1');
    });

    it('maps interactive client_type → author_type human', async () => {
      const { annotation } = await annotationsService.create(interactiveCtx(), {
        doc_path: 'svc/annotations-tests',
        heading_path: 'Test',
        content: 'Interactive → human',
      });
      expect(annotation.author_type).toBe('human');
    });

    it('maps autonomous client_type → author_type ai', async () => {
      const { annotation } = await annotationsService.create(autonomousCtx(), {
        doc_path: 'svc/annotations-tests',
        heading_path: 'Test',
        content: 'Autonomous → ai',
      });
      expect(annotation.author_type).toBe('ai');
    });

    it('falls back to anonymous when ctx has no user (dev passthrough)', async () => {
      const { annotation } = await annotationsService.create({}, {
        doc_path: 'svc/annotations-tests',
        heading_path: 'Test',
        content: 'Dev mode',
      });
      expect(annotation.user_id).toBe('anonymous');
    });

    it('auto-submits AI annotations; holds human top-level ones as draft', async () => {
      const aiRes = await annotationsService.create(autonomousCtx(), {
        doc_path: 'svc/annotations-tests',
        heading_path: 'Test',
        content: 'AI defaults to submitted',
      });
      expect(aiRes.annotation.status).toBe('submitted');

      const humanRes = await annotationsService.create(interactiveCtx(), {
        doc_path: 'svc/annotations-tests',
        heading_path: 'Test',
        content: 'Human top-level defaults to draft',
      });
      expect(humanRes.annotation.status).toBe('draft');
    });

    it('throws ValidationError when required fields missing', async () => {
      await expect(
        annotationsService.create(interactiveCtx(), {
          doc_path: 'svc/annotations-tests',
          heading_path: '',
          content: 'missing heading',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws NotFoundError when doc does not exist', async () => {
      await expect(
        annotationsService.create(interactiveCtx(), {
          doc_path: 'does/not/exist',
          heading_path: 'Any',
          content: 'irrelevant',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects invalid status values', async () => {
      await expect(
        annotationsService.create(interactiveCtx(), {
          doc_path: 'svc/annotations-tests',
          heading_path: 'Test',
          content: 'bad status',
          status: 'invalid-status' as any,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('get / list / edit / delete', () => {
    it('get throws NotFoundError for missing id', async () => {
      await expect(
        annotationsService.get({}, { id: 'does-not-exist' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('list filters by status', async () => {
      const ctx = interactiveCtx();
      await annotationsService.create(ctx, {
        doc_path: 'svc/annotations-tests',
        heading_path: 'ListTest',
        content: 'will be listed',
      });

      const drafts = await annotationsService.list(ctx, {
        doc_path: 'svc/annotations-tests',
        status: 'draft',
      });
      expect(drafts.every(a => a.status === 'draft')).toBe(true);
      expect(drafts.length).toBeGreaterThan(0);
    });

    it('edit requires at least one mutable field', async () => {
      await expect(
        annotationsService.edit({}, { id: 'any' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('resolve / reopen round-trip the status', async () => {
      const ctx = interactiveCtx();
      const { annotation: created } = await annotationsService.create(ctx, {
        doc_path: 'svc/annotations-tests',
        heading_path: 'Resolve',
        content: 'to be resolved',
      });

      const resolved = await annotationsService.resolve(ctx, { id: created.id });
      expect(resolved.status).toBe('resolved');

      const reopened = await annotationsService.reopen(ctx, { id: created.id });
      expect(reopened.status).toBe('draft');
    });

    it('del throws NotFoundError for unknown id, succeeds for known', async () => {
      await expect(
        annotationsService.del({}, { id: 'definitely-not-here' }),
      ).rejects.toBeInstanceOf(NotFoundError);

      const ctx = interactiveCtx();
      const { annotation } = await annotationsService.create(ctx, {
        doc_path: 'svc/annotations-tests',
        heading_path: 'DeleteMe',
        content: 'gone soon',
      });
      await expect(
        annotationsService.del(ctx, { id: annotation.id }),
      ).resolves.toBeUndefined();
    });
  });
});
