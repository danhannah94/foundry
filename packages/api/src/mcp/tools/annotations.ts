import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getDb } from '../../db.js';
import { createId } from '@paralleldrive/cuid2';
import type { Annotation } from '../../types/annotations.js';

/**
 * Verify authentication token for MCP annotation tools
 * Returns null if auth is valid, or an error response object if invalid
 */
export function verifyAuthToken(authToken?: string): { content: Array<{ type: string; text: string }>; isError: true } | null {
  const expectedToken = process.env.FOUNDRY_WRITE_TOKEN;

  // If auth token is not configured, allow all requests (dev mode)
  if (!expectedToken) {
    return null;
  }

  // Check if auth token is provided and matches
  if (!authToken || authToken !== expectedToken) {
    return {
      content: [{ type: "text", text: "Authentication required. Provide a valid auth_token parameter." }],
      isError: true
    };
  }

  return null;
}

/**
 * Core annotation functions that can be tested
 */
export function listAnnotations(docPath: string, section?: string, status?: string): Annotation[] {
  const db = getDb();
  let query = 'SELECT * FROM annotations WHERE doc_path = ?';
  const params: any[] = [docPath];

  if (section) {
    query += ' AND heading_path LIKE ?';
    params.push(`%${section}%`);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';
  const rows = db.prepare(query).all(...params);
  return rows as Annotation[];
}

export function createAnnotation(params: {
  doc_path: string;
  section: string;
  content: string;
  parent_id?: string;
  author_type?: string
}): Annotation {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();

  // BUG-6: If replying to a parent, inherit its review_id
  let effectiveReviewId: string | null = null;
  if (params.parent_id) {
    const parent = db.prepare('SELECT review_id FROM annotations WHERE id = ?').get(params.parent_id) as { review_id: string | null } | undefined;
    if (parent?.review_id) {
      effectiveReviewId = parent.review_id;
    }
  }

  const annotation = {
    id,
    doc_path: params.doc_path,
    heading_path: params.section,
    content_hash: '', // MCP callers don't need to provide this
    quoted_text: null,
    content: params.content,
    parent_id: params.parent_id || null,
    review_id: effectiveReviewId,
    user_id: 'clay',
    author_type: params.author_type || 'ai',
    status: params.parent_id ? 'replied' : 'submitted',
    created_at: now,
    updated_at: now,
  } as Annotation;

  // INSERT into annotations table
  db.prepare(`INSERT INTO annotations (id, doc_path, heading_path, content_hash, quoted_text, content, parent_id, review_id, user_id, author_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    annotation.id, annotation.doc_path, annotation.heading_path, annotation.content_hash,
    annotation.quoted_text, annotation.content, annotation.parent_id, annotation.review_id,
    annotation.user_id, annotation.author_type, annotation.status, annotation.created_at, annotation.updated_at
  );

  return annotation;
}

export function resolveAnnotation(annotationId: string): { status: string; annotation_id?: string; message?: string } {
  const db = getDb();

  const existing = db.prepare('SELECT * FROM annotations WHERE id = ?').get(annotationId);
  if (!existing) {
    return { status: "error", message: "Annotation not found" };
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE annotations SET status = ?, updated_at = ? WHERE id = ?').run('resolved', now, annotationId);

  return { status: "resolved", annotation_id: annotationId };
}

export function submitReview(docPath: string, annotationIds?: string[]): object {
  const db = getDb();

  // Create review record
  const reviewId = createId();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO reviews (id, doc_path, user_id, status, submitted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    reviewId, docPath, 'dan', 'submitted', now, now, now
  );

  // Get annotations to include
  let annotations: Annotation[];
  if (annotationIds && annotationIds.length > 0) {
    const placeholders = annotationIds.map(() => '?').join(',');
    annotations = db.prepare(`SELECT * FROM annotations WHERE id IN (${placeholders})`).all(...annotationIds) as Annotation[];
  } else {
    // Default: all draft/submitted annotations for this doc
    annotations = db.prepare('SELECT * FROM annotations WHERE doc_path = ? AND status IN (?, ?)').all(docPath, 'draft', 'submitted') as Annotation[];
  }

  // Update annotations with review_id and status
  for (const ann of annotations) {
    db.prepare('UPDATE annotations SET review_id = ?, status = ?, updated_at = ? WHERE id = ?').run(reviewId, 'submitted', now, ann.id);
  }

  // Build structured payload for OpenClaw
  const payload = {
    status: "review_submitted",
    review_id: reviewId,
    doc_path: docPath,
    submitted_at: now,
    comment_count: annotations.length,
    comments: annotations.map(a => ({
      id: a.id,
      heading_path: a.heading_path,
      quoted_text: a.quoted_text,
      content: a.content,
    })),
  };

  return payload;
}

/**
 * Register annotation tools with the MCP server
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
              auth_token: {
                type: 'string',
                description: 'Authentication token (required when FOUNDRY_WRITE_TOKEN is set)'
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
              },
              author_type: {
                type: 'string',
                description: 'Optional author type (human or ai), defaults to ai for MCP callers'
              },
              auth_token: {
                type: 'string',
                description: 'Authentication token (required when FOUNDRY_WRITE_TOKEN is set)'
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
                description: 'Authentication token (required when FOUNDRY_WRITE_TOKEN is set)'
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
                description: 'Authentication token (required when FOUNDRY_WRITE_TOKEN is set)'
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
    const { name, arguments: args } = request.params;
    
    if (!args) {
      throw new Error('Tool arguments are required');
    }

    switch (name) {
      case 'list_annotations': {
        // Verify authentication
        const authError = verifyAuthToken(args.auth_token as string | undefined);
        if (authError) {
          return authError;
        }

        const result = listAnnotations(
          args.doc_path as string,
          args.section as string | undefined,
          args.status as string | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case 'create_annotation': {
        // Verify authentication
        const authError = verifyAuthToken(args.auth_token as string | undefined);
        if (authError) {
          return authError;
        }

        const result = createAnnotation({
          doc_path: args.doc_path as string,
          section: args.section as string,
          content: args.content as string,
          parent_id: args.parent_id as string | undefined,
          author_type: args.author_type as string | undefined
        });
        return { content: [{ type: "text", text: JSON.stringify({ status: "created", annotation: result }) }] };
      }

      case 'resolve_annotation': {
        // Verify authentication
        const authError = verifyAuthToken(args.auth_token as string | undefined);
        if (authError) {
          return authError;
        }

        const result = resolveAnnotation(args.annotation_id as string);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      case 'submit_review': {
        // Verify authentication
        const authError = verifyAuthToken(args.auth_token as string | undefined);
        if (authError) {
          return authError;
        }

        const result = submitReview(
          args.doc_path as string,
          args.annotation_ids as string[] | undefined
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}