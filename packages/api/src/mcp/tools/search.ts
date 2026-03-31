import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Anvil } from '@claymore-dev/anvil';

interface SearchToolArgs {
  query: string;
  top_k?: number;
}

interface SearchResultItem {
  path: string;
  heading: string;
  snippet: string;
  score: number;
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
    const { query, top_k = 10 } = searchArgs;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new Error('Query is required and must be a non-empty string');
    }

    try {
      // Call anvil search with the same logic as the REST endpoint
      const searchResults = await anvil.search(query, top_k);

      // Transform results to match the REST endpoint format
      const results: SearchResultItem[] = searchResults.map(result => ({
        path: result.metadata.file_path,
        heading: result.metadata.heading_path,
        snippet: result.content.slice(0, 200),
        score: result.score,
      }));

      const response = {
        results,
        query,
        totalResults: results.length,
      };

      // Add warning if no results found
      if (results.length === 0 && top_k !== 0) {
        (response as any).warning = 'No results found. The Anvil index may be empty or the query did not match any content.';
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}