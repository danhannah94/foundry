import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { searchDocs } from '../http-client.js';

interface SearchToolArgs {
  query: string;
  top_k?: number;
  auth_token?: string;
}

/**
 * Registers the search_docs tool with the MCP server.
 * Search goes through the HTTP API via http-client (no Anvil dependency).
 */
export function registerSearchTool(server: Server): void {
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

    if (!query || typeof query !== 'string' || query.trim() === '') {
      throw new Error('Query is required and must be a non-empty string');
    }

    const response = await searchDocs(query, top_k, auth_token);

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
