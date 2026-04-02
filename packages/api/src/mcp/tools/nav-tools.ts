import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listPages } from '../http-client.js';

/**
 * Register nav tools with the MCP server.
 * All data access goes through the HTTP API via http-client.
 */
export function registerNavTools(server: Server): void {

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_pages',
          description: 'List all pages in the Foundry nav tree with their paths and access levels.',
          inputSchema: {
            type: 'object',
            properties: {
              include_private: {
                type: 'boolean',
                description: 'Include private pages in results (default: false)',
                default: false,
              },
            },
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name !== 'list_pages') {
      throw new Error(`Unknown tool: ${name}`);
    }

    const includePrivate = (args?.include_private as boolean) || false;
    const result = await listPages(includePrivate);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });
}
