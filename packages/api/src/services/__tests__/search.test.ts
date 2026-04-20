/**
 * Service-level unit tests for searchService.
 *
 * Focus: the scope-based private-doc filter (the branch that differs
 * between anonymous/authenticated callers). The Anvil index is stubbed
 * so tests don't need a running model.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as searchService from '../search.js';
import { ValidationError } from '../errors.js';
import * as accessModule from '../../access.js';
import type { AuthContext } from '../context.js';

function mockAnvil(results: Array<{ content: string; score: number; metadata: any }>): any {
  return {
    getStatus: vi.fn(async () => ({ total_chunks: results.length + 10 })),
    search: vi.fn(async () => results),
  };
}

function basicResult(path: string, heading: string, score: number) {
  return {
    content: `content for ${path}`,
    score,
    metadata: {
      file_path: path,
      heading_path: heading,
      char_count: 100,
    },
  };
}

describe('searchService.search', () => {
  beforeAll(() => {
    // Stub getAccessLevel: treat 'private/*' as private, everything else public.
    vi.spyOn(accessModule, 'getAccessLevel').mockImplementation((p: string) =>
      p.startsWith('private/') ? 'private' : 'public',
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('throws ValidationError on missing query', async () => {
    const anvil = mockAnvil([]);
    await expect(
      searchService.search({}, anvil, { query: undefined as any }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError on empty query', async () => {
    const anvil = mockAnvil([]);
    await expect(
      searchService.search({}, anvil, { query: '   ' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns warning when index empty', async () => {
    const anvil = {
      getStatus: vi.fn(async () => ({ total_chunks: 0 })),
      search: vi.fn(async () => []),
    } as any;
    const result = await searchService.search({}, anvil, { query: 'foo' });
    expect(result.totalResults).toBe(0);
    expect(result.warning).toContain('Anvil index is empty');
  });

  it('anonymous callers see only public results', async () => {
    const anvil = mockAnvil([
      basicResult('public/doc1.md', 'H1', 0.9),
      basicResult('private/secret.md', 'H2', 0.9),
    ]);
    const result = await searchService.search({}, anvil, { query: 'foo' });
    expect(result.results.map(r => r.path)).toEqual(['public/doc1.md']);
  });

  it('callers with docs:read:private see private results', async () => {
    const anvil = mockAnvil([
      basicResult('public/doc1.md', 'H1', 0.9),
      basicResult('private/secret.md', 'H2', 0.9),
    ]);
    const ctx: AuthContext = {
      user: {
        id: 'u',
        github_login: 'a',
        scopes: ['docs:read', 'docs:read:private'],
      },
    };
    const result = await searchService.search(ctx, anvil, { query: 'foo' });
    expect(result.results.map(r => r.path).sort()).toEqual([
      'private/secret.md',
      'public/doc1.md',
    ]);
  });

  it('filters out results below MIN_RELEVANCE_SCORE (0.5)', async () => {
    const anvil = mockAnvil([
      basicResult('public/high.md', 'H1', 0.9),
      basicResult('public/low.md', 'H2', 0.2),
    ]);
    const result = await searchService.search({}, anvil, { query: 'foo' });
    expect(result.results.map(r => r.path)).toEqual(['public/high.md']);
  });

  it('returns "No results matched" warning when filtered result set is empty', async () => {
    const anvil = mockAnvil([basicResult('public/low.md', 'H1', 0.1)]);
    const result = await searchService.search({}, anvil, { query: 'foo' });
    expect(result.totalResults).toBe(0);
    expect(result.warning).toContain('No results matched');
  });

  it('auth with no read:private scope still sees public-only', async () => {
    const anvil = mockAnvil([
      basicResult('public/doc1.md', 'H1', 0.9),
      basicResult('private/secret.md', 'H2', 0.9),
    ]);
    const ctx: AuthContext = {
      user: { id: 'u', github_login: 'a', scopes: ['docs:read'] },
    };
    const result = await searchService.search(ctx, anvil, { query: 'foo' });
    expect(result.results.map(r => r.path)).toEqual(['public/doc1.md']);
  });
});
