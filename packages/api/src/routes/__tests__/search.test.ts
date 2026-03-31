import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Anvil } from '@claymore-dev/anvil';
import { createSearchRouter } from '../search.js';

// Mock Anvil instance
const mockAnvil = {
  search: vi.fn(),
} as unknown as Anvil;

// Create test app
const app = express();
app.use(express.json());
app.use('/api', createSearchRouter(mockAnvil));

describe('POST /search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});