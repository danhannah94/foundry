import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Anvil } from '@claymore-dev/anvil';
import { createSearchRouter } from '../search.js';
import * as access from '../../access.js';

// Mock Anvil instance
const mockAnvil = {
  search: vi.fn(),
  getStatus: vi.fn(),
} as unknown as Anvil;

// Create test app
const app = express();
app.use(express.json());
app.use('/api', createSearchRouter(mockAnvil));

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
      warning: 'No results found. The Anvil index may be empty or the query did not match any content.',
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
      expect(response.body.results.map(r => r.path)).toEqual([
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

    it('should include all results when FOUNDRY_WRITE_TOKEN is not set (dev mode)', async () => {
      // Clear the env var to simulate dev mode
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

      // Should return both results in dev mode
      expect(response.body.results).toHaveLength(2);
      expect(response.body.totalResults).toBe(2);

      // Restore the env var for other tests
      process.env.FOUNDRY_WRITE_TOKEN = 'test-token';
    });
  });
});