/**
 * Service-level unit tests for pagesService.
 *
 * Exercises the private-doc filtering, section-fetch happy/error paths,
 * and the listDocs anvil integration. Anvil is mocked; real filesystem
 * is used for getSection (it reads markdown files directly).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import * as pagesService from '../pages.js';
import * as navModule from '../../utils/nav-generator.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { AuthContext } from '../context.js';

const testContentDir = join(tmpdir(), `foundry-svc-pages-content-${Date.now()}`);

beforeAll(() => {
  process.env.CONTENT_DIR = testContentDir;
  mkdirSync(testContentDir, { recursive: true });
  // Seed a fake markdown file for getSection tests.
  mkdirSync(join(testContentDir, 'svc'), { recursive: true });
  writeFileSync(
    join(testContentDir, 'svc/pages-tests.md'),
    `# Intro\n\nHello.\n\n## Details\n\nBody text.\n\n### Sub\n\nMore.\n`,
    'utf-8',
  );
});

afterAll(() => {
  try { rmSync(testContentDir, { recursive: true, force: true }); } catch {}
  delete process.env.CONTENT_DIR;
});

const ctx: AuthContext = {};

describe('pagesService.listPages', () => {
  afterAll(() => vi.restoreAllMocks());

  it('filters private docs when includePrivate=false', async () => {
    vi.spyOn(navModule, 'generateNavPages').mockReturnValue([
      { title: 'Pub', path: '/pub', access: 'public' },
      { title: 'Priv', path: '/priv', access: 'private' },
    ]);
    const pages = await pagesService.listPages(ctx, { includePrivate: false });
    expect(pages.map(p => p.path)).toEqual(['/pub']);
  });

  it('returns all pages when includePrivate=true', async () => {
    vi.spyOn(navModule, 'generateNavPages').mockReturnValue([
      { title: 'Pub', path: '/pub', access: 'public' },
      { title: 'Priv', path: '/priv', access: 'private' },
    ]);
    const pages = await pagesService.listPages(ctx, { includePrivate: true });
    expect(pages.map(p => p.path).sort()).toEqual(['/priv', '/pub']);
  });
});

describe('pagesService.getSection', () => {
  it('returns the section content when heading matches', async () => {
    const result = await pagesService.getSection(ctx, {
      path: 'svc/pages-tests',
      headingPath: '## Details',
    });
    // section-parser returns the canonical heading path (with # prefix).
    expect(result.heading).toBe('## Details');
    expect(result.level).toBe(2);
    expect(result.content).toContain('Body text.');
  });

  it('throws NotFoundError with available_headings for unknown section', async () => {
    try {
      await pagesService.getSection(ctx, {
        path: 'svc/pages-tests',
        headingPath: '## Does Not Exist',
      });
      throw new Error('expected to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.extra?.available_headings).toBeDefined();
      expect(Array.isArray(err.extra.available_headings)).toBe(true);
    }
  });

  it('throws NotFoundError when doc missing', async () => {
    await expect(
      pagesService.getSection(ctx, {
        path: 'does/not/exist',
        headingPath: '## Whatever',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('pagesService.getPage private-doc gate', () => {
  const anvil: any = {
    getPage: vi.fn(async () => ({
      file_path: 'foo.md',
      title: 'Foo',
      last_modified: '2024-01-01',
      chunks: [],
    })),
  };

  afterAll(() => vi.restoreAllMocks());

  it('throws ValidationError when private and !canReadPrivate', async () => {
    // Stub the access-level check to say the path is private.
    const accessModule = await import('../../access.js');
    vi.spyOn(accessModule, 'getAccessLevel').mockReturnValue('private');

    await expect(
      pagesService.getPage(ctx, anvil, {
        path: 'private/doc',
        canReadPrivate: false,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows through when private and canReadPrivate', async () => {
    const accessModule = await import('../../access.js');
    vi.spyOn(accessModule, 'getAccessLevel').mockReturnValue('private');

    const page = await pagesService.getPage(ctx, anvil, {
      path: 'private/doc',
      canReadPrivate: true,
    });
    expect(page.path).toBe('foo.md');
  });
});
