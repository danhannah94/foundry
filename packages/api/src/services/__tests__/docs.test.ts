/**
 * Service-level unit tests for docsService.
 *
 * Focus: validation edges, happy-path createDoc / updateSection, and
 * the NotFoundError / ConflictError branches that MCP callers (S10b)
 * will surface to users.
 *
 * invalidateContent is stubbed at module scope so tests don't start a
 * real Express server; the service dynamic-imports index.js and calls
 * this mock.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, unlinkSync, rmSync, existsSync, readFileSync } from 'fs';

vi.mock('../../index.js', () => ({
  invalidateContent: vi.fn(async () => {}),
}));

import * as docsService from '../docs.js';
import { NotFoundError, ValidationError, ConflictError } from '../errors.js';
import { getDb, closeDb } from '../../db.js';
import type { AuthContext } from '../context.js';

const testDbPath = join(tmpdir(), `foundry-svc-docs-${Date.now()}.db`);
const testContentDir = join(tmpdir(), `foundry-svc-docs-content-${Date.now()}`);

function seedDoc(relPath: string, content: string): string {
  const filePath = join(testContentDir, `${relPath}.md`);
  mkdirSync(join(testContentDir, ...relPath.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');

  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO docs_meta (path, title, access, content_hash, modified_at, modified_by, created_at)
    VALUES (?, ?, 'public', 'testhash', ?, 'test', ?)
  `).run(relPath, relPath, now, now);

  return filePath;
}

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  process.env.CONTENT_DIR = testContentDir;
  mkdirSync(testContentDir, { recursive: true });
  getDb();
});

afterAll(() => {
  closeDb();
  try { unlinkSync(testDbPath); } catch {}
  try { rmSync(testContentDir, { recursive: true, force: true }); } catch {}
  delete process.env.FOUNDRY_DB_PATH;
  delete process.env.CONTENT_DIR;
});

const ctx: AuthContext = {};

describe('docsService.createDoc', () => {
  it('rejects when path missing', async () => {
    await expect(
      docsService.createDoc(ctx, { path: '', template: 'blank' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects invalid template', async () => {
    await expect(
      docsService.createDoc(ctx, { path: 'svc/new', template: 'not-a-real-template' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates a blank doc with derived title when none provided', async () => {
    const result = await docsService.createDoc(ctx, {
      path: 'svc/fresh-doc',
      template: 'blank',
    });
    expect(result.created).toBe(true);
    expect(result.title).toBe('Fresh Doc');
    const written = readFileSync(join(testContentDir, 'svc/fresh-doc.md'), 'utf-8');
    expect(written).toContain('# Fresh Doc');
  });

  it('409s when doc already exists', async () => {
    seedDoc('svc/already-exists', '# Already\n');
    await expect(
      docsService.createDoc(ctx, {
        path: 'svc/already-exists',
        template: 'blank',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('docsService.updateSection', () => {
  it('throws NotFoundError when doc missing', async () => {
    await expect(
      docsService.updateSection(ctx, {
        path: 'missing/doc',
        headingPath: '## Anything',
        content: 'body',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ValidationError when content non-string', async () => {
    await expect(
      docsService.updateSection(ctx, {
        path: 'svc/any',
        headingPath: '## Anything',
        content: undefined as any,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updates the matching section', async () => {
    seedDoc(
      'svc/updatable',
      `# Top\n\n## Body\n\nold prose\n\n## Footer\n\nfooter text\n`,
    );

    await docsService.updateSection(ctx, {
      path: 'svc/updatable',
      headingPath: '## Body',
      content: 'new prose',
    });

    const written = readFileSync(join(testContentDir, 'svc/updatable.md'), 'utf-8');
    expect(written).toContain('new prose');
    expect(written).not.toContain('old prose');
    // Footer survived
    expect(written).toContain('footer text');
  });

  it('returns NotFoundError with available_headings on miss', async () => {
    seedDoc(
      'svc/heading-miss',
      `# Top\n\n## A\n\nbody\n`,
    );
    try {
      await docsService.updateSection(ctx, {
        path: 'svc/heading-miss',
        headingPath: '## DoesNotExist',
        content: 'x',
      });
      throw new Error('expected throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.extra?.available_headings).toBeDefined();
    }
  });
});

describe('docsService.deleteDoc', () => {
  it('throws NotFoundError when file missing', async () => {
    await expect(
      docsService.deleteDoc(ctx, { path: 'nowhere/no-such-doc' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes file + docs_meta row when both present', async () => {
    seedDoc('svc/deletable', '# Deletable\n\nbody\n');
    const filePath = join(testContentDir, 'svc/deletable.md');
    expect(existsSync(filePath)).toBe(true);

    const result = await docsService.deleteDoc(ctx, { path: 'svc/deletable' });
    expect(result.deleted).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });
});

describe('docsService.insertSection validation', () => {
  it('rejects invalid level', async () => {
    await expect(
      docsService.insertSection(ctx, {
        path: 'svc/whatever',
        after_heading: '## A',
        heading: 'B',
        level: 99 as any,
        content: 'x',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
