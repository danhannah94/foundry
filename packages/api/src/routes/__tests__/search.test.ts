// Module-top env: required by middleware/auth.ts WWW-Authenticate builder.
// (Search only 401s via softAuth -> never, but a mis-built header could still
// throw; setting this matches the convention used by other OAuth test suites.)
process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.test';

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import type { Anvil } from '@claymore-dev/anvil';
import { AnvilHolder } from '../../anvil-holder.js';
import { createSearchRouter } from '../search.js';
import * as access from '../../access.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, tokensDao, usersDao } from '../../oauth/dao.js';

// Create an AnvilHolder with a mock Anvil pre-loaded
function createReadyHolder(mockAnvil: Anvil): AnvilHolder {
  const holder = new AnvilHolder();
  (holder as any).anvil = mockAnvil;
  (holder as any)._status = 'ready';
  return holder;
}

// Mock Anvil instance
const mockAnvil = {
  search: vi.fn(),
  getStatus: vi.fn(),
} as unknown as Anvil;

// Create test app
const app = express();
app.use(express.json());
app.use('/api', createSearchRouter(createReadyHolder(mockAnvil)));

describe('POST /search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up test environment for auth
    process.env.FOUNDRY_WRITE_TOKEN = 'test-token';

    // Mock getAccessLevel to simulate access controls
    vi.spyOn(access, 'getAccessLevel').mockImplementation((path) => {
      if (path.startsWith('projects/')) return 'private';
      return 'public';
    });

    // Mock getStatus to return a valid status with content
    mockAnvil.getStatus.mockResolvedValue({ total_chunks: 100 });
  });

  it('should return search results successfully', async () => {
    const mockResults = [
      {
        content: 'This is a sample content about methodology and process refinement. It contains detailed information about how to refine your approach.',
        score: 0.85,
        metadata: {
          file_path: 'methodology/process.md',
          heading_path: 'Refinement',
          heading_level: 2,
          last_modified: '2024-01-01T00:00:00Z',
          char_count: 1200,
        },
      },
      {
        content: 'Another piece of content with different information that matches the search query.',
        score: 0.72,
        metadata: {
          file_path: 'guide/introduction.md',
          heading_path: 'Getting Started',
          heading_level: 1,
          last_modified: '2024-01-02T00:00:00Z',
          char_count: 800,
        },
      },
    ];

    mockAnvil.search.mockResolvedValue(mockResults);

    const response = await request(app)
      .post('/api/search')
      .send({ query: 'test query' })
      .expect(200);

    expect(mockAnvil.search).toHaveBeenCalledWith('test query', 10);
    expect(response.body).toEqual({
      results: [
        {
          path: 'methodology/process.md',
          heading: 'Refinement',
          snippet: 'This is a sample content about methodology and process refinement. It contains detailed information about how to refine your approach.',
          score: 0.85,
          charCount: 1200,
        },
        {
          path: 'guide/introduction.md',
          heading: 'Getting Started',
          snippet: 'Another piece of content with different information that matches the search query.',
          score: 0.72,
          charCount: 800,
        },
      ],
      query: 'test query',
      totalResults: 2,
    });
  });

  it('should return 400 when query is missing', async () => {
    const response = await request(app)
      .post('/api/search')
      .send({})
      .expect(400);

    expect(response.body).toEqual({
      error: 'Missing or invalid "query" field. Expected a non-empty string.',
    });

    expect(mockAnvil.search).not.toHaveBeenCalled();
  });

  it('should return 400 when query is empty string', async () => {
    const response = await request(app)
      .post('/api/search')
      .send({ query: '' })
      .expect(400);

    expect(response.body).toEqual({
      error: 'Query cannot be an empty string.',
    });

    expect(mockAnvil.search).not.toHaveBeenCalled();
  });

  it('should return 400 when query is whitespace only', async () => {
    const response = await request(app)
      .post('/api/search')
      .send({ query: '   ' })
      .expect(400);

    expect(response.body).toEqual({
      error: 'Query cannot be an empty string.',
    });

    expect(mockAnvil.search).not.toHaveBeenCalled();
  });

  it('should pass custom topK parameter', async () => {
    const mockResults = [];
    mockAnvil.search.mockResolvedValue(mockResults);

    await request(app)
      .post('/api/search')
      .send({ query: 'test query', topK: 5 })
      .expect(200);

    expect(mockAnvil.search).toHaveBeenCalledWith('test query', 5);
  });

  it('should return empty array when no matches found', async () => {
    mockAnvil.search.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/search')
      .send({ query: 'no matches query' })
      .expect(200);

    expect(response.body).toEqual({
      results: [],
      query: 'no matches query',
      totalResults: 0,
      warning: 'No results matched your query.',
    });
  });

  it('should not show warning when topK is 0 and no results', async () => {
    mockAnvil.search.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/search')
      .send({ query: 'test query', topK: 0 })
      .expect(200);

    expect(response.body).toEqual({
      results: [],
      query: 'test query',
      totalResults: 0,
    });

    expect(response.body.warning).toBeUndefined();
  });

  it('should truncate content to 200 characters in snippet', async () => {
    const longContent = 'a'.repeat(300);
    const mockResults = [
      {
        content: longContent,
        score: 0.85,
        metadata: {
          file_path: 'test.md',
          heading_path: 'Test',
          heading_level: 1,
          last_modified: '2024-01-01T00:00:00Z',
          char_count: 300,
        },
      },
    ];

    mockAnvil.search.mockResolvedValue(mockResults);

    const response = await request(app)
      .post('/api/search')
      .send({ query: 'test' })
      .expect(200);

    expect(response.body.results[0].snippet).toHaveLength(200);
    expect(response.body.results[0].snippet).toBe('a'.repeat(200));
  });

  describe('Access filtering', () => {
    it('should filter out private results when no auth token is provided', async () => {
      const mockResults = [
        {
          content: 'Public content in methodology',
          score: 0.85,
          metadata: {
            file_path: 'methodology/process.md',
            heading_path: 'Process',
            heading_level: 1,
            last_modified: '2024-01-01T00:00:00Z',
            char_count: 100,
          },
        },
        {
          content: 'Private content in projects',
          score: 0.75,
          metadata: {
            file_path: 'projects/secret/design.md',
            heading_path: 'Secret Design',
            heading_level: 1,
            last_modified: '2024-01-02T00:00:00Z',
            char_count: 200,
          },
        },
      ];

      mockAnvil.search.mockResolvedValue(mockResults);

      const response = await request(app)
        .post('/api/search')
        .send({ query: 'test query' })
        .expect(200);

      // Should only return the public result
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].path).toBe('methodology/process.md');
      expect(response.body.totalResults).toBe(1);
    });

    it('should include private results when valid auth token is provided', async () => {
      const mockResults = [
        {
          content: 'Public content in methodology',
          score: 0.85,
          metadata: {
            file_path: 'methodology/process.md',
            heading_path: 'Process',
            heading_level: 1,
            last_modified: '2024-01-01T00:00:00Z',
            char_count: 100,
          },
        },
        {
          content: 'Private content in projects',
          score: 0.75,
          metadata: {
            file_path: 'projects/secret/design.md',
            heading_path: 'Secret Design',
            heading_level: 1,
            last_modified: '2024-01-02T00:00:00Z',
            char_count: 200,
          },
        },
      ];

      mockAnvil.search.mockResolvedValue(mockResults);

      const response = await request(app)
        .post('/api/search')
        .set('Authorization', 'Bearer test-token')
        .send({ query: 'test query' })
        .expect(200);

      // Should return both public and private results
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results.map((r: any) => r.path)).toEqual([
        'methodology/process.md',
        'projects/secret/design.md',
      ]);
      expect(response.body.totalResults).toBe(2);
    });

    it('should filter out private results when invalid auth token is provided', async () => {
      const mockResults = [
        {
          content: 'Public content in methodology',
          score: 0.85,
          metadata: {
            file_path: 'methodology/process.md',
            heading_path: 'Process',
            heading_level: 1,
            last_modified: '2024-01-01T00:00:00Z',
            char_count: 100,
          },
        },
        {
          content: 'Private content in projects',
          score: 0.75,
          metadata: {
            file_path: 'projects/secret/design.md',
            heading_path: 'Secret Design',
            heading_level: 1,
            last_modified: '2024-01-02T00:00:00Z',
            char_count: 200,
          },
        },
      ];

      mockAnvil.search.mockResolvedValue(mockResults);

      const response = await request(app)
        .post('/api/search')
        .set('Authorization', 'Bearer invalid-token')
        .send({ query: 'test query' })
        .expect(200);

      // Should only return the public result
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].path).toBe('methodology/process.md');
      expect(response.body.totalResults).toBe(1);
    });

    it('AC3 (S9) — unauthenticated + no legacy token configured → public only, no 401', async () => {
      // S9 contract: /api/search is auth-optional (the ONE such route),
      // but anonymous callers get public results only. Pre-E12 this test
      // expected all results in "dev mode" — that was the bug #99 fixes.
      delete process.env.FOUNDRY_WRITE_TOKEN;

      const mockResults = [
        {
          content: 'Public content in methodology',
          score: 0.85,
          metadata: {
            file_path: 'methodology/process.md',
            heading_path: 'Process',
            heading_level: 1,
            last_modified: '2024-01-01T00:00:00Z',
            char_count: 100,
          },
        },
        {
          content: 'Private content in projects',
          score: 0.75,
          metadata: {
            file_path: 'projects/secret/design.md',
            heading_path: 'Secret Design',
            heading_level: 1,
            last_modified: '2024-01-02T00:00:00Z',
            char_count: 200,
          },
        },
      ];

      mockAnvil.search.mockResolvedValue(mockResults);

      const response = await request(app)
        .post('/api/search')
        .send({ query: 'test query' })
        .expect(200);

      // Should only return the public result — anonymous = no private scope
      expect(response.body.results).toHaveLength(1);
      expect(response.body.results[0].path).toBe('methodology/process.md');
      expect(response.body.totalResults).toBe(1);

      // Restore the env var for other tests
      process.env.FOUNDRY_WRITE_TOKEN = 'test-token';
    });
  });

  describe('503 during initialization', () => {
    it('should return 503 with Retry-After when Anvil is initializing', async () => {
      const initHolder = new AnvilHolder();
      (initHolder as any)._status = 'initializing';

      const initApp = express();
      initApp.use(express.json());
      initApp.use('/api', createSearchRouter(initHolder));

      const response = await request(initApp)
        .post('/api/search')
        .send({ query: 'test' })
        .expect(503);

      expect(response.headers['retry-after']).toBe('5');
      expect(response.body).toEqual({
        status: 'initializing',
        message: 'Search index is loading, please retry',
        retryAfter: 5,
      });
    });

    it('should return 503 when Anvil is unavailable', async () => {
      const errorHolder = new AnvilHolder();
      (errorHolder as any)._status = 'error';

      const errorApp = express();
      errorApp.use(express.json());
      errorApp.use('/api', createSearchRouter(errorHolder));

      const response = await request(errorApp)
        .post('/api/search')
        .send({ query: 'test' })
        .expect(503);

      expect(response.body).toEqual({ error: 'Service unavailable' });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S9 — OAuth scope matrix for /api/search
//
// Covers AC1–AC3 using real OAuth tokens (not the legacy FOUNDRY_WRITE_TOKEN
// path). Each mint produces a token tied to an actual user in the test DB;
// the search router's softAuth middleware introspects it exactly as
// requireAuth does in S7 — no bypass.
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /search — S9 OAuth scope matrix', () => {
  const testDbPath = join(
    tmpdir(),
    `foundry-search-s9-test-${process.pid}-${Date.now()}.db`
  );

  let userId: string;
  let clientId: string;
  const s9MockAnvil = {
    search: vi.fn(),
    getStatus: vi.fn(),
  } as unknown as Anvil;
  const s9App = express();
  s9App.use(express.json());
  s9App.use('/api', createSearchRouter(createReadyHolderForS9(s9MockAnvil)));

  // Same mock results used across all scope-matrix tests.
  const mockResults = [
    {
      content: 'Public content in methodology',
      score: 0.85,
      metadata: {
        file_path: 'methodology/process.md',
        heading_path: 'Process',
        heading_level: 1,
        last_modified: '2024-01-01T00:00:00Z',
        char_count: 100,
      },
    },
    {
      content: 'Private content in projects',
      score: 0.75,
      metadata: {
        file_path: 'projects/secret/design.md',
        heading_path: 'Secret Design',
        heading_level: 1,
        last_modified: '2024-01-02T00:00:00Z',
        char_count: 200,
      },
    },
  ];

  beforeAll(() => {
    process.env.FOUNDRY_DB_PATH = testDbPath;
    closeDb();
    getDb(); // creates schema

    const user = usersDao.upsert({ github_login: 'bob', github_id: 424242 });
    userId = user.id;

    const { id } = clientsDao.register({
      name: 'Search Test Connector',
      redirect_uris: 'https://example.com/cb',
      client_type: 'autonomous',
    });
    clientId = id;
  });

  afterAll(() => {
    closeDb();
    try {
      unlinkSync(testDbPath);
    } catch {
      /* ignore */
    }
    delete process.env.FOUNDRY_DB_PATH;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Un-set legacy token so OAuth path is the only auth mechanism.
    delete process.env.FOUNDRY_WRITE_TOKEN;

    vi.spyOn(access, 'getAccessLevel').mockImplementation((path) => {
      if (path.startsWith('projects/')) return 'private';
      return 'public';
    });
    (s9MockAnvil.getStatus as any).mockResolvedValue({ total_chunks: 100 });
    (s9MockAnvil.search as any).mockResolvedValue(mockResults);
  });

  it('AC1 — OAuth user WITH docs:read:private → sees private results', async () => {
    const { access_token } = tokensDao.mint({
      client_id: clientId,
      user_id: userId,
      scope: 'docs:read docs:read:private',
    });

    const response = await request(s9App)
      .post('/api/search')
      .set('Authorization', `Bearer ${access_token}`)
      .send({ query: 'test query' })
      .expect(200);

    expect(response.body.results).toHaveLength(2);
    expect(response.body.results.map((r: any) => r.path)).toEqual([
      'methodology/process.md',
      'projects/secret/design.md',
    ]);
  });

  it('AC2 — OAuth user WITHOUT docs:read:private → public only, 200 (no 401)', async () => {
    const { access_token } = tokensDao.mint({
      client_id: clientId,
      user_id: userId,
      scope: 'docs:read', // deliberately missing docs:read:private
    });

    const response = await request(s9App)
      .post('/api/search')
      .set('Authorization', `Bearer ${access_token}`)
      .send({ query: 'test query' })
      .expect(200);

    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].path).toBe('methodology/process.md');
  });

  it('AC3 — unauthenticated (no header) → public only, 200 (no 401)', async () => {
    // Product requirement: browser anonymous search must not 401. This is
    // the only auth-optional route in the system.
    const response = await request(s9App)
      .post('/api/search')
      .send({ query: 'test query' })
      .expect(200);

    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].path).toBe('methodology/process.md');
  });

  it('softAuth swallows invalid tokens — bogus Bearer returns public-only, not 401', async () => {
    const response = await request(s9App)
      .post('/api/search')
      .set('Authorization', 'Bearer this-is-not-a-real-token')
      .send({ query: 'test query' })
      .expect(200);

    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].path).toBe('methodology/process.md');
  });

  it('softAuth swallows revoked tokens — revoked Bearer returns public-only, not 401', async () => {
    const { access_token } = tokensDao.mint({
      client_id: clientId,
      user_id: userId,
      scope: 'docs:read docs:read:private',
    });
    tokensDao.revoke(access_token);

    const response = await request(s9App)
      .post('/api/search')
      .set('Authorization', `Bearer ${access_token}`)
      .send({ query: 'test query' })
      .expect(200);

    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].path).toBe('methodology/process.md');
  });

  it('softAuth swallows malformed header — Basic auth gets public-only, not 401', async () => {
    const response = await request(s9App)
      .post('/api/search')
      .set('Authorization', 'Basic something')
      .send({ query: 'test query' })
      .expect(200);

    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].path).toBe('methodology/process.md');
  });
});

// Local helper so the top-file helper doesn't get hoisted into a shared
// closure that the S9 block's mockAnvil could see stale.
function createReadyHolderForS9(mockAnvil: Anvil): AnvilHolder {
  const holder = new AnvilHolder();
  (holder as any).anvil = mockAnvil;
  (holder as any)._status = 'ready';
  return holder;
}
