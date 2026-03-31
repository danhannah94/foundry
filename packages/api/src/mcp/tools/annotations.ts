import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Register annotation tools with the MCP server
 */
export function registerAnnotationTools(server: Server): void {
  // Not implemented response helper
  const notImplementedResponse = {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        status: "not_implemented",
        message: "Annotation tools will be available in E4."
      })
    }]
  };

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_annotations',
          description: 'List annotations for a document, optionally filtered by section',
          inputSchema: {
            type: 'object',
            properties: {
              doc_path: {
                type: 'string',
                description: 'Path to the document'
              },
              section: {
                type: 'string',
                description: 'Optional section filter'
              }
            },
            required: ['doc_path']
          }
        },
        {
          name: 'create_annotation',
          description: 'Create an annotation on a document section',
          inputSchema: {
            type: 'object',
            properties: {
              doc_path: {
                type: 'string',
                description: 'Path to the document'
              },
              section: {
                type: 'string',
                description: 'Section identifier'
              },
              content: {
                type: 'string',
                description: 'Annotation content'
              },
              parent_id: {
                type: 'string',
                description: 'Optional parent annotation ID for threading'
              }
            },
            required: ['doc_path', 'section', 'content']
          }
        },
        {
          name: 'resolve_annotation',
          description: 'Mark an annotation as resolved',
          inputSchema: {
            type: 'object',
            properties: {
              annotation_id: {
                type: 'string',
                description: 'ID of the annotation to resolve'
              }
            },
            required: ['annotation_id']
          }
        },
        {
          name: 'submit_review',
          description: 'Submit annotations as a review batch',
          inputSchema: {
            type: 'object',
            properties: {
              doc_path: {
                type: 'string',
                description: 'Path to the document being reviewed'
              },
              annotation_ids: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Optional array of annotation IDs to include in review'
              }
            },
            required: ['doc_path']
          }
        }
      ]
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    switch (name) {
      case 'list_annotations':
      case 'create_annotation':
      case 'resolve_annotation':
      case 'submit_review':
        return notImplementedResponse;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}