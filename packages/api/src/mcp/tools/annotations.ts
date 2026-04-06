import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  listAnnotations,
  getAnnotation,
  createAnnotation,
  resolveAnnotation,
  deleteAnnotation,
  editAnnotation,
  reopenAnnotation,
  submitReview,
} from '../http-client.js';

/**
 * Register annotation tools with the MCP server.
 * All data access goes through the HTTP API via http-client.
 */
export function registerAnnotationTools(server: Server): void {

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
              },
              status: {
                type: 'string',
                description: 'Optional status filter (draft, submitted, replied, resolved, orphaned)'
              },
              review_id: {
                type: 'string',
                description: 'Optional review ID to filter annotations by review'
              },
              auth_token: {
                type: 'string',
                description: 'Authentication token (kept for backward compatibility)'
              }
            },
            required: ['doc_path']
          }
        },
        {
          name: 'get_annotation',
          description: 'Get a single annotation by ID, including its reply thread.',
          inputSchema: {
            type: 'object',
            properties: {
              annotation_id: {
                type: 'string',
                description: 'ID of the annotation to retrieve'
              }
            },
            required: ['annotation_id']
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
              },
              author_type: {
                type: 'string',
                description: 'Optional author type (human or ai), defaults to ai for MCP callers'
              },
              quoted_text: {
                type: 'string',
                description: 'Optional highlighted text that the annotation refers to'
              },
              auth_token: {
                type: 'string',
                description: 'Authentication token (kept for backward compatibility)'
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
              },
              auth_token: {
                type: 'string',
                description: 'Authentication token (kept for backward compatibility)'
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
              },
              auth_token: {
                type: 'string',
                description: 'Authentication token (kept for backward compatibility)'
              }
            },
            required: ['doc_path']
          }
        },
        {
          name: 'delete_annotation',
          description: 'Delete an annotation by ID. If the annotation has child replies, all replies are cascade-deleted.',
          inputSchema: {
            type: 'object',
            properties: {
              annotation_id: {
                type: 'string',
                description: 'ID of the annotation to delete'
              }
            },
            required: ['annotation_id']
          }
        },
        {
          name: 'edit_annotation',
          description: 'Edit the content of an existing annotation.',
          inputSchema: {
            type: 'object',
            properties: {
              annotation_id: {
                type: 'string',
                description: 'ID of the annotation to edit'
              },
              content: {
                type: 'string',
                description: 'New content for the annotation'
              }
            },
            required: ['annotation_id', 'content']
          }
        },
        {
          name: 'reopen_annotation',
          description: 'Reopen a previously resolved annotation.',
          inputSchema: {
            type: 'object',
            properties: {
              annotation_id: {
                type: 'string',
                description: 'ID of the annotation to reopen'
              }
            },
            required: ['annotation_id']
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
      case 'list_annotations': {
        const result = await listAnnotations(
          args.doc_path as string,
          args.section as string | undefined,
          args.status as string | undefined,
          args.review_id as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case 'get_annotation': {
        const result = await getAnnotation(args.annotation_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case 'create_annotation': {
        const result = await createAnnotation({
          doc_path: args.doc_path as string,
          section: args.section as string,
          content: args.content as string,
          parent_id: args.parent_id as string | undefined,
          author_type: args.author_type as string | undefined,
          quoted_text: args.quoted_text as string | undefined
        });
        return { content: [{ type: "text", text: JSON.stringify({ status: "created", annotation: result }) }] };
      }

      case 'resolve_annotation': {
        const result = await resolveAnnotation(args.annotation_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case 'submit_review': {
        const result = await submitReview(
          args.doc_path as string,
          args.annotation_ids as string[] | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case 'delete_annotation': {
        const result = await deleteAnnotation(args.annotation_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case 'edit_annotation': {
        const result = await editAnnotation(
          args.annotation_id as string,
          args.content as string,
        );
        return { content: [{ type: "text", text: JSON.stringify({ status: "updated", annotation: result }) }] };
      }

      case 'reopen_annotation': {
        const result = await reopenAnnotation(args.annotation_id as string);
        return { content: [{ type: "text", text: JSON.stringify({ status: "reopened", annotation: result }) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}
