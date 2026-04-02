import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { listReviews, getReview } from '../http-client.js';

/**
 * Register review tools with the MCP server.
 * All data access goes through the HTTP API via http-client.
 */
export function registerReviewTools(server: Server): void {

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_reviews',
          description: 'List reviews for a document, optionally filtered by status',
          inputSchema: {
            type: 'object',
            properties: {
              doc_path: {
                type: 'string',
                description: 'Path to the document'
              },
              status: {
                type: 'string',
                description: 'Optional status filter (draft, submitted, complete)'
              }
            },
            required: ['doc_path']
          }
        },
        {
          name: 'get_review',
          description: 'Get a single review by ID, including its annotations.',
          inputSchema: {
            type: 'object',
            properties: {
              review_id: {
                type: 'string',
                description: 'ID of the review to retrieve'
              }
            },
            required: ['review_id']
          }
        }
      ]
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
      throw new Error('Tool arguments are required');
    }

    switch (name) {
      case 'list_reviews': {
        const result = await listReviews(
          args.doc_path as string,
          args.status as string | undefined,
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case 'get_review': {
        const result = await getReview(args.review_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}
