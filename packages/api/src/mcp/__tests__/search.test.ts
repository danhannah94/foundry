import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the http-client module
vi.mock('../http-client.js', () => ({
  searchDocs: vi.fn(),
}));

import { searchDocs } from '../http-client.js';

const mockSearchDocs = vi.mocked(searchDocs);

describe('MCP search_docs via HTTP client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return search results from HTTP API', async () => {
    mockSearchDocs.mockResolvedValue({
      results: [
        { path: 'methodology/process.md', heading: 'Process', snippet: 'Public content', score: 0.85 },
      ],
      query: 'test query',
      totalResults: 1,
    });

    const response = await searchDocs('test query');

    expect(mockSearchDocs).toHaveBeenCalledWith('test query');
    expect(response.results).toHaveLength(1);
    expect(response.results[0].path).toBe('methodology/process.md');
    expect(response.totalResults).toBe(1);
  });

  it('should pass auth_token as parameter for private results', async () => {
    mockSearchDocs.mockResolvedValue({
      results: [
        { path: 'methodology/process.md', heading: 'Process', snippet: 'Public', score: 0.85 },
        { path: 'projects/secret/design.md', heading: 'Secret', snippet: 'Private', score: 0.75 },
      ],
      query: 'test query',
      totalResults: 2,
    });

    const response = await searchDocs('test query', 10, 'test-token');

    expect(mockSearchDocs).toHaveBeenCalledWith('test query', 10, 'test-token');
    expect(response.results).toHaveLength(2);
  });

  it('should respect custom top_k parameter', async () => {
    mockSearchDocs.mockResolvedValue({
      results: [{ path: 'test.md', heading: 'Test', snippet: 'Content', score: 0.9 }],
      query: 'test query',
      totalResults: 1,
    });

    await searchDocs('test query', 5);

    expect(mockSearchDocs).toHaveBeenCalledWith('test query', 5);
  });

  it('should propagate errors from HTTP API', async () => {
    mockSearchDocs.mockRejectedValue(new Error('API POST /api/search failed (500): Internal error'));

    await expect(searchDocs('test query')).rejects.toThrow('API POST /api/search failed');
  });

  it('should return warning when no results found', async () => {
    mockSearchDocs.mockResolvedValue({
      results: [],
      query: 'obscure query',
      totalResults: 0,
      warning: 'No results found. The Anvil index may be empty or the query did not match any content.',
    });

    const response = await searchDocs('obscure query');

    expect(response.results).toHaveLength(0);
    expect(response.warning).toBeDefined();
  });
});
