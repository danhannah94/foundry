import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Anvil } from '@claymore-dev/anvil';
import { registerSearchTool } from '../tools/search.js';
import * as access from '../../access.js';

// Mock Anvil instance
const mockAnvil = {
  search: vi.fn(),
} as unknown as Anvil;

// TODO: MCP Server test setup needs refactoring — registerSearchTool + registerAnnotationTools
// both call setRequestHandler(ListToolsRequestSchema) which overwrites handlers.
// Core search filtering logic is covered by route tests (routes/__tests__/search.test.ts).
describe.skip('MCP search_docs tool access filtering', () => {
  let server: Server;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up test environment for auth
    process.env.FOUNDRY_WRITE_TOKEN = 'test-token';

    // Mock getAccessLevel to simulate access controls
    vi.spyOn(access, 'getAccessLevel').mockImplementation((path) => {
      if (path.startsWith('projects/')) return 'private';
      return 'public';
    });

    // Create a new server instance for each test
    server = new Server(
      { name: 'test-mcp-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    // Register the search tool
    registerSearchTool(server, mockAnvil);
  });

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

    // Simulate calling the tool
    const result = await server.handleRequest({
      method: 'tools/call',
      params: {
        name: 'search_docs',
        arguments: {
          query: 'test query',
        },
      },
    } as any);

    expect(mockAnvil.search).toHaveBeenCalledWith('test query', 10);

    // Parse the response
    const response = JSON.parse(result.content[0].text);

    // Should only return the public result
    expect(response.results).toHaveLength(1);
    expect(response.results[0].path).toBe('methodology/process.md');
    expect(response.totalResults).toBe(1);
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

    // Simulate calling the tool with auth token
    const result = await server.handleRequest({
      method: 'tools/call',
      params: {
        name: 'search_docs',
        arguments: {
          query: 'test query',
          auth_token: 'test-token',
        },
      },
    } as any);

    expect(mockAnvil.search).toHaveBeenCalledWith('test query', 10);

    // Parse the response
    const response = JSON.parse(result.content[0].text);

    // Should return both public and private results
    expect(response.results).toHaveLength(2);
    expect(response.results.map(r => r.path)).toEqual([
      'methodology/process.md',
      'projects/secret/design.md',
    ]);
    expect(response.totalResults).toBe(2);
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

    // Simulate calling the tool with invalid auth token
    const result = await server.handleRequest({
      method: 'tools/call',
      params: {
        name: 'search_docs',
        arguments: {
          query: 'test query',
          auth_token: 'invalid-token',
        },
      },
    } as any);

    expect(mockAnvil.search).toHaveBeenCalledWith('test query', 10);

    // Parse the response
    const response = JSON.parse(result.content[0].text);

    // Should only return the public result
    expect(response.results).toHaveLength(1);
    expect(response.results[0].path).toBe('methodology/process.md');
    expect(response.totalResults).toBe(1);
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

    // Simulate calling the tool without auth token (should work in dev mode)
    const result = await server.handleRequest({
      method: 'tools/call',
      params: {
        name: 'search_docs',
        arguments: {
          query: 'test query',
        },
      },
    } as any);

    expect(mockAnvil.search).toHaveBeenCalledWith('test query', 10);

    // Parse the response
    const response = JSON.parse(result.content[0].text);

    // Should return both results in dev mode
    expect(response.results).toHaveLength(2);
    expect(response.totalResults).toBe(2);

    // Restore the env var for other tests
    process.env.FOUNDRY_WRITE_TOKEN = 'test-token';
  });

  it('should respect custom top_k parameter', async () => {
    const mockResults = [
      {
        content: 'Test content',
        score: 0.85,
        metadata: {
          file_path: 'methodology/process.md',
          heading_path: 'Process',
          heading_level: 1,
          last_modified: '2024-01-01T00:00:00Z',
          char_count: 100,
        },
      },
    ];

    mockAnvil.search.mockResolvedValue(mockResults);

    // Simulate calling the tool with custom top_k
    await server.handleRequest({
      method: 'tools/call',
      params: {
        name: 'search_docs',
        arguments: {
          query: 'test query',
          top_k: 5,
        },
      },
    } as any);

    expect(mockAnvil.search).toHaveBeenCalledWith('test query', 5);
  });

  it('should throw error for invalid query', async () => {
    await expect(
      server.handleRequest({
        method: 'tools/call',
        params: {
          name: 'search_docs',
          arguments: {
            query: '',
          },
        },
      } as any)
    ).rejects.toThrow('Query is required and must be a non-empty string');

    expect(mockAnvil.search).not.toHaveBeenCalled();
  });

  it('should handle search errors gracefully', async () => {
    const searchError = new Error('Search service unavailable');
    mockAnvil.search.mockRejectedValue(searchError);

    await expect(
      server.handleRequest({
        method: 'tools/call',
        params: {
          name: 'search_docs',
          arguments: {
            query: 'test query',
          },
        },
      } as any)
    ).rejects.toThrow('Search failed: Search service unavailable');
  });
});