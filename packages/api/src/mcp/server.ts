import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  listAnnotations,
  getAnnotation,
  createAnnotation,
  editAnnotation,
  deleteAnnotation,
  resolveAnnotation,
  reopenAnnotation,
  submitReview,
  listReviews,
  getReview,
  listPages,
  searchDocs,
  getPage,
  getSection,
  getStatus,
  reindex,
  importRepo,
  createDoc,
  updateSection,
  insertSection,
  deleteSection,
  moveSection,
  deleteDoc,
  syncToGithub,
} from './http-client.js';

/**
 * Creates and configures the MCP server for Foundry.
 *
 * All tools communicate via HTTP API (no direct DB or Anvil dependency).
 * Tools and call handlers are registered once (MCP SDK allows only one
 * handler per request schema — multiple setRequestHandler calls overwrite).
 */
export function createMcpServer(): Server {
  const server = new Server({
    name: 'foundry',
    version: '0.3.0',
  }, {
    capabilities: {
      tools: {}
    }
  });

  // ── Tool Definitions ────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // Annotation tools
      {
        name: 'list_annotations',
        description: 'List annotations for a document, optionally filtered by section, status, or review_id.',
        inputSchema: {
          type: 'object',
          properties: {
            doc_path: { type: 'string', description: 'Path to the document' },
            section: { type: 'string', description: 'Optional section filter' },
            status: { type: 'string', description: 'Optional status filter (draft, submitted, replied, resolved, orphaned)' },
            review_id: { type: 'string', description: 'Optional review ID to filter annotations by review' },
          },
          required: ['doc_path'],
        },
      },
      {
        name: 'get_annotation',
        description: 'Get a single annotation by ID, including its reply thread.',
        inputSchema: {
          type: 'object',
          properties: {
            annotation_id: { type: 'string', description: 'ID of the annotation to retrieve' },
          },
          required: ['annotation_id'],
        },
      },
      {
        name: 'create_annotation',
        description: 'Create an annotation on a document section.',
        inputSchema: {
          type: 'object',
          properties: {
            doc_path: { type: 'string', description: 'Path to the document' },
            section: { type: 'string', description: 'Section identifier' },
            content: { type: 'string', description: 'Annotation content' },
            parent_id: { type: 'string', description: 'Optional parent annotation ID for threading' },
            author_type: { type: 'string', description: 'Optional author type (human or ai), defaults to ai' },
            quoted_text: { type: 'string', description: 'Optional highlighted text that the annotation refers to' },
            status: { type: 'string', description: 'Optional status override (draft, submitted, replied, resolved, orphaned). When omitted, defaults to submitted for ai and draft for human.' },
          },
          required: ['doc_path', 'section', 'content'],
        },
      },
      {
        name: 'edit_annotation',
        description: 'Edit the content of an existing annotation.',
        inputSchema: {
          type: 'object',
          properties: {
            annotation_id: { type: 'string', description: 'ID of the annotation to edit' },
            content: { type: 'string', description: 'New content for the annotation' },
          },
          required: ['annotation_id', 'content'],
        },
      },
      {
        name: 'delete_annotation',
        description: 'Delete an annotation by ID. If the annotation has child replies, all replies are cascade-deleted.',
        inputSchema: {
          type: 'object',
          properties: {
            annotation_id: { type: 'string', description: 'ID of the annotation to delete' },
          },
          required: ['annotation_id'],
        },
      },
      {
        name: 'resolve_annotation',
        description: 'Mark an annotation as resolved.',
        inputSchema: {
          type: 'object',
          properties: {
            annotation_id: { type: 'string', description: 'ID of the annotation to resolve' },
          },
          required: ['annotation_id'],
        },
      },
      {
        name: 'reopen_annotation',
        description: 'Reopen a previously resolved annotation, returning it to draft status for editing before re-submission. Note: the annotation does NOT return to its prior submitted/replied state — it becomes a draft so you can edit it and then resubmit via submit_review.',
        inputSchema: {
          type: 'object',
          properties: {
            annotation_id: { type: 'string', description: 'ID of the annotation to reopen' },
          },
          required: ['annotation_id'],
        },
      },
      {
        name: 'submit_review',
        description: 'Submit annotations as a review batch.',
        inputSchema: {
          type: 'object',
          properties: {
            doc_path: { type: 'string', description: 'Path to the document being reviewed' },
            annotation_ids: { type: 'array', items: { type: 'string' }, description: 'Optional array of annotation IDs to include in review' },
          },
          required: ['doc_path'],
        },
      },
      // Review tools
      {
        name: 'list_reviews',
        description: 'List reviews for a document, optionally filtered by status.',
        inputSchema: {
          type: 'object',
          properties: {
            doc_path: { type: 'string', description: 'Path to the document' },
            status: { type: 'string', description: 'Optional status filter (draft, submitted, complete)' },
          },
          required: ['doc_path'],
        },
      },
      {
        name: 'get_review',
        description: 'Get a single review by ID, including its annotations.',
        inputSchema: {
          type: 'object',
          properties: {
            review_id: { type: 'string', description: 'ID of the review to retrieve' },
          },
          required: ['review_id'],
        },
      },
      // Nav tools
      {
        name: 'list_pages',
        description: 'List all pages in the Foundry nav tree with their paths and access levels.',
        inputSchema: {
          type: 'object',
          properties: {
            include_private: { type: 'boolean', description: 'Include private pages (default: false)', default: false },
          },
        },
      },
      // Search tools
      {
        name: 'search_docs',
        description: 'Semantic search across Foundry documentation. Results are filtered to a minimum relevance score of 0.5.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query to find relevant documentation' },
            top_k: { type: 'number', description: 'Number of results to return (default: 10)', default: 10 },
            auth_token: { type: 'string', description: 'Optional auth token to include private doc results' },
          },
          required: ['query'],
        },
      },
      // Page tools
      {
        name: 'get_page',
        description: 'Get a single document page by path, including its section structure.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the document' },
          },
          required: ['path'],
        },
      },
      {
        name: 'get_section',
        description: 'Get a specific section from a document by path and heading.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the document' },
            heading_path: { type: 'string', description: 'Heading path of the section to retrieve' },
          },
          required: ['path', 'heading_path'],
        },
      },
      // Status tools
      {
        name: 'get_status',
        description: 'Get Foundry server health and status, including Anvil index statistics.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'reindex',
        description: 'Trigger a full reindex of all documentation. Requires authentication.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      // Import tools
      {
        name: 'import_repo',
        description: 'Import documentation from a GitHub repository into Foundry. Clones the repo, copies markdown files to the content directory, and populates docs_meta. Requires authentication.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository URL (e.g., https://github.com/org/repo)' },
            branch: { type: 'string', description: 'Git branch to import from (default: main)' },
            prefix: { type: 'string', description: 'Path prefix within repo to import from, stripped from output paths (default: docs/)' },
          },
          required: ['repo'],
        },
      },
      // Doc CRUD tools
      {
        name: 'create_doc',
        description: 'Create a new document from a template.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path relative to content root, no .md extension' },
            template: { type: 'string', description: 'Template name — epic, subsystem, project, workflow, or blank' },
            title: { type: 'string', description: 'Document title (defaults to template default or path-derived)' },
            content: { type: 'string', description: 'Optional full markdown content. When provided, used instead of template content. Template is still required for validation but only used as fallback.' },
          },
          required: ['path', 'template'],
        },
      },
      {
        name: 'update_section',
        description: 'Update a section\'s content by heading path. Replaces the section body AND all descendant sub-sections (the entire subtree under this heading). The heading itself is preserved as the address. Throws 404 with available_headings on no-match — NEVER silently appends.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path' },
            heading_path: { type: 'string', description: 'Canonical heading path: `#` prefix on every level, separated by ` > `. e.g. "## Overview" or "## Architecture > ### Tech Stack".' },
            content: { type: 'string', description: 'New body content (markdown, NOT including the heading)' },
          },
          required: ['path', 'heading_path', 'content'],
        },
      },
      {
        name: 'insert_section',
        description: 'Insert a new section after an existing heading. Throws 404 with available_headings on no-match — NEVER silently appends.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path' },
            after_heading_path: { type: 'string', description: 'Canonical heading path to insert after: `#` prefix on every level, separated by ` > `. e.g. "## Architecture > ### Tech Stack".' },
            heading: { type: 'string', description: 'New section heading text (without # prefix — this is the content to insert, not an address)' },
            level: { type: 'number', description: 'Heading level (2 for ##, 3 for ###, etc.)' },
            content: { type: 'string', description: 'Section body content' },
          },
          required: ['path', 'after_heading_path', 'heading', 'level', 'content'],
        },
      },
      {
        name: 'move_section',
        description: 'Move a section (including all descendants) to a new position after another heading. Atomic — either the whole move succeeds or nothing changes.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path' },
            heading: { type: 'string', description: 'Heading path of the section to move (full or short-form)' },
            after_heading: { type: 'string', description: 'Heading path to move the section after (full or short-form). Section will be placed after this heading and all its descendants.' },
          },
          required: ['path', 'heading', 'after_heading'],
        },
      },
      {
        name: 'delete_section',
        description: 'Delete a section by heading path. Cascades: removes the heading line, its prose, and ALL descendant sections (everything until the next heading at the same or shallower level). Cannot delete the H1 heading — use delete_doc instead. Throws 404 with available_headings on no-match — NEVER silently mutates.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path' },
            heading_path: { type: 'string', description: 'Canonical heading path to delete: `#` prefix on every level, separated by ` > `.' },
          },
          required: ['path', 'heading_path'],
        },
      },
      {
        name: 'delete_doc',
        description: 'Delete a document and all its annotations. HARD delete — not recoverable. Use sync_to_github first if you need a backup.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Document path (no .md extension)' },
          },
          required: ['path'],
        },
      },
      // Sync tools
      {
        name: 'sync_to_github',
        description: 'Push content to a configured GitHub repository as a backup. Force-pushes — Foundry always wins on conflict.',
        inputSchema: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Git remote URL (overrides SYNC_REMOTE_URL env var)' },
            branch: { type: 'string', description: 'Target branch (default: main)' },
          },
        },
      },
    ],
  }));

  // ── Tool Call Dispatch ──────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!args) throw new Error('Tool arguments are required');

    const json = (data: unknown) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    });

    switch (name) {
      // ── Annotations ─────────────────────────────────────────
      case 'list_annotations': {
        const result = await listAnnotations(
          args.doc_path as string,
          args.section as string | undefined,
          args.status as string | undefined,
          args.review_id as string | undefined,
        );
        return json(result);
      }
      case 'get_annotation': {
        const result = await getAnnotation(args.annotation_id as string);
        return json(result);
      }
      case 'create_annotation': {
        const result = await createAnnotation({
          doc_path: args.doc_path as string,
          section: args.section as string,
          content: args.content as string,
          parent_id: args.parent_id as string | undefined,
          author_type: args.author_type as string | undefined,
          quoted_text: args.quoted_text as string | undefined,
          status: args.status as string | undefined,
        });
        return json({ status: 'created', annotation: result });
      }
      case 'edit_annotation': {
        const result = await editAnnotation(args.annotation_id as string, args.content as string);
        return json({ status: 'updated', annotation: result });
      }
      case 'delete_annotation': {
        const result = await deleteAnnotation(args.annotation_id as string);
        return json(result);
      }
      case 'resolve_annotation': {
        const result = await resolveAnnotation(args.annotation_id as string);
        return json(result);
      }
      case 'reopen_annotation': {
        const result = await reopenAnnotation(args.annotation_id as string);
        return json({ status: 'reopened', annotation: result });
      }
      case 'submit_review': {
        const result = await submitReview(
          args.doc_path as string,
          args.annotation_ids as string[] | undefined,
        );
        return json(result);
      }
      // ── Reviews ─────────────────────────────────────────────
      case 'list_reviews': {
        const result = await listReviews(
          args.doc_path as string,
          args.status as string | undefined,
        );
        return json(result);
      }
      case 'get_review': {
        const result = await getReview(args.review_id as string);
        return json(result);
      }
      // ── Nav ─────────────────────────────────────────────────
      case 'list_pages': {
        const result = await listPages((args.include_private as boolean) || false);
        return json(result);
      }
      // ── Search ──────────────────────────────────────────────
      case 'search_docs': {
        const result = await searchDocs(
          args.query as string,
          (args.top_k as number) || 10,
          args.auth_token as string | undefined,
        );
        return json(result);
      }
      // ── Pages ──────────────────────────────────────────────
      case 'get_page': {
        const result = await getPage(args.path as string);
        return json(result);
      }
      case 'get_section': {
        const result = await getSection(
          args.path as string,
          args.heading_path as string,
        );
        return json(result);
      }
      // ── Status ─────────────────────────────────────────────
      case 'get_status': {
        const result = await getStatus();
        return json(result);
      }
      case 'reindex': {
        const result = await reindex();
        return json(result);
      }
      // ── Import ─────────────────────────────────────────────
      case 'import_repo': {
        const result = await importRepo(
          args.repo as string,
          args.branch as string | undefined,
          args.prefix as string | undefined,
        );
        return json(result);
      }
      // ── Doc CRUD ────────────────────────────────────────────
      case 'create_doc': {
        const result = await createDoc(
          args.path as string,
          args.template as string,
          args.title as string | undefined,
          args.content as string | undefined,
        );
        return json({ status: 'created', doc: result });
      }
      case 'update_section': {
        const result = await updateSection(
          args.path as string,
          args.heading_path as string,
          args.content as string,
        );
        return json({ status: 'updated', section: result });
      }
      case 'insert_section': {
        const result = await insertSection(
          args.path as string,
          args.after_heading_path as string,
          args.heading as string,
          args.level as number,
          args.content as string,
        );
        return json({ status: 'inserted', section: result });
      }
      case 'move_section': {
        const result = await moveSection(
          args.path as string,
          args.heading as string,
          args.after_heading as string,
        );
        return json({ status: 'moved', result });
      }
      case 'delete_section': {
        const result = await deleteSection(
          args.path as string,
          args.heading_path as string,
        );
        return json({ status: 'deleted', result });
      }
      case 'delete_doc': {
        const result = await deleteDoc(args.path as string);
        return json({ status: 'deleted', result });
      }
      // ── Sync ─────────────────────────────────────────────
      case 'sync_to_github': {
        const result = await syncToGithub(
          args.remote as string | undefined,
          args.branch as string | undefined,
        );
        return json(result);
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}
