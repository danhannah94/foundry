import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Anvil } from '@claymore-dev/anvil';
import { getAccessLevel } from '../../access.js';

interface SearchToolArgs {
  query: string;
  top_k?: number;
  auth_token?: string;
}

interface SearchResultItem {
  path: string;
  heading: string;
  snippet: string;
  score: number;
}

/**
 * Check if the provided auth token is valid
 */
function isTokenValid(authToken?: string): boolean {
  const expectedToken = process.env.FOUNDRY_WRITE_TOKEN;

  // If auth token is not configured, allow all requests (dev mode)
  if (!expectedToken) return true;

  // Check if auth token is provided and matches
  return authToken === expectedToken;
}

/**
 * Execute a search query with access filtering
 * This function contains the core logic that can be tested directly
 */
export async function executeSearchQuery(
  anvil: Anvil,
  query: string,
  topK: number = 10,
  authToken?: string
): Promise<{ results: SearchResultItem[]; query: string; totalResults: number; warning?: string }> {
  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new Error('Query is required and must be a non-empty string');
  }

  try {
    // Call anvil search with the same logic as the REST endpoint
    const searchResults = await anvil.search(query, topK);

    // Transform results to match the REST endpoint format
    const results: SearchResultItem[] = searchResults.map(result => ({
      path: result.metadata.file_path,
      heading: result.metadata.heading_path,
      snippet: result.content.slice(0, 200),
      score: result.score,
    }));

    // Filter results based on access level and authentication
    const isAuthed = isTokenValid(authToken);
    const filteredResults = isAuthed
      ? results
      : results.filter(r => getAccessLevel(r.path) !== "private");

    const response = {
      results: filteredResults,
      query,
      totalResults: filteredResults.length,
    };

    // Add warning if no results found
    if (filteredResults.length === 0 && topK !== 0) {
      (response as any).warning = 'No results found. The Anvil index may be empty or the query did not match any content.';
    }

    return response;
  } catch (error) {
    throw new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Registers the search_docs tool with the MCP server
 */
export function registerSearchTool(server: Server, anvil: Anvil): void {
  // Register the tool
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'search_docs',
          description: 'Semantic search across Foundry documentation',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query to find relevant documentation',
              },
              top_k: {
                type: 'number',
                description: 'Number of results to return (default: 10)',
                default: 10,
              },
              auth_token: {
                type: 'string',
                description: 'Optional auth token to include private doc results',
              },
            },
            required: ['query'],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name !== 'search_docs') {
      throw new Error(`Unknown tool: ${name}`);
    }

    const searchArgs = args as unknown as SearchToolArgs;
    const { query, top_k = 10, auth_token } = searchArgs;

    // Use the extracted function for testability
    const response = await executeSearchQuery(anvil, query, top_k, auth_token);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  });
}