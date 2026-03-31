import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDb, closeDb } from '../../db.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  listAnnotations,
  createAnnotation,
  resolveAnnotation,
  submitReview,
  registerAnnotationTools
} from '../tools/annotations.js';
import { registerSearchTool } from '../tools/search.js';

// Mock Anvil for search tool tests
const mockAnvil = {
  search: async (query: string, topK: number) => {
    // Return mock search results for testing
    return [
      {
        content: 'This is test content for the search query',
        metadata: {
          file_path: 'test-doc.md',
          heading_path: 'Test Section'
        },
        score: 0.95
      }
    ];
  }
} as any;

// Mock the db module to use a test database
let testDbPath: string;
let originalToken: string | undefined;

beforeEach(() => {
  // Save original env
  originalToken = process.env.FOUNDRY_WRITE_TOKEN;

  // Create a temporary directory for test database
  const tempDir = mkdtempSync(join(tmpdir(), 'foundry-test-'));
  testDbPath = join(tempDir, 'test.db');
  process.env.FOUNDRY_DB_PATH = testDbPath;

  // Initialize the test database
  const db = getDb();

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      doc_path TEXT NOT NULL,
      heading_path TEXT,
      content_hash TEXT,
      quoted_text TEXT,
      content TEXT NOT NULL,
      parent_id TEXT,
      review_id TEXT,
      user_id TEXT NOT NULL,
      author_type TEXT NOT NULL CHECK (author_type IN ('human', 'ai')),
      status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'replied', 'resolved', 'orphaned')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      doc_path TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
      submitted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
});

afterEach(() => {
  // Restore original env
  if (originalToken === undefined) {
    delete process.env.FOUNDRY_WRITE_TOKEN;
  } else {
    process.env.FOUNDRY_WRITE_TOKEN = originalToken;
  }

  // Clean up test database
  closeDb();
  if (testDbPath) {
    try {
      rmSync(testDbPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }
  delete process.env.FOUNDRY_DB_PATH;
});

/**
 * Test verifyAuthToken function directly
 */
function testVerifyAuthToken(authToken?: string) {
  // Extract the verifyAuthToken function to test it directly
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
 * Helper function to simulate MCP tool calls for testing
 */
async function callMcpTool(toolName: string, args: any, includeSearchTool = false): Promise<any> {
  const server = new Server({
    name: 'foundry-test',
    version: '0.2.0',
  }, {
    capabilities: {
      tools: {}
    }
  });

  // Register annotation tools
  registerAnnotationTools(server);

  // Register search tool if requested
  if (includeSearchTool) {
    registerSearchTool(server, mockAnvil);
  }

  // Get the call tool request handler by accessing the private _requestHandlers
  const callHandler = (server as any)._requestHandlers?.get(CallToolRequestSchema.name);
  if (!callHandler) {
    // Try alternative access patterns
    const handlers = (server as any).requestHandlers || (server as any)._handlers;
    const altHandler = handlers?.get(CallToolRequestSchema.name) || handlers?.get('tools/call');
    if (!altHandler) {
      throw new Error('No call handler registered');
    }

    // Use the alternative handler
    const request = {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    try {
      const result = await altHandler(request);
      return result;
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true
      };
    }
  }

  // Simulate tool call
  const request = {
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args
    }
  };

  try {
    const result = await callHandler(request);
    return result;
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

describe('Core annotation functions (no auth)', () => {
  describe('listAnnotations', () => {
    it('should list annotations for a doc_path', () => {
      const annotation = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const results = listAnnotations('test-doc.md');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(annotation.id);
      expect(results[0].content).toBe('Test annotation');
    });

    it('should filter by section', () => {
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Intro annotation'
      });
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'conclusion',
        content: 'Conclusion annotation'
      });

      const results = listAnnotations('test-doc.md', 'intro');
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Intro annotation');
    });

    it('should filter by status', () => {
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Draft annotation'
      });
      const resolved = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Resolved annotation'
      });
      resolveAnnotation(resolved.id);

      const submittedResults = listAnnotations('test-doc.md', undefined, 'submitted');
      expect(submittedResults).toHaveLength(1);
      expect(submittedResults[0].content).toBe('Draft annotation');

      const resolvedResults = listAnnotations('test-doc.md', undefined, 'resolved');
      expect(resolvedResults).toHaveLength(1);
      expect(resolvedResults[0].content).toBe('Resolved annotation');
    });
  });

  describe('createAnnotation', () => {
    it('should create annotation with default values', () => {
      const annotation = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      expect(annotation.id).toBeTruthy();
      expect(annotation.doc_path).toBe('test-doc.md');
      expect(annotation.heading_path).toBe('intro');
      expect(annotation.content).toBe('Test annotation');
      expect(annotation.user_id).toBe('clay');
      expect(annotation.author_type).toBe('ai');
      expect(annotation.status).toBe('submitted');
      expect(annotation.parent_id).toBeNull();
      expect(annotation.created_at).toBeTruthy();
      expect(annotation.updated_at).toBeTruthy();
    });

    it('should create reply annotation when parent_id provided', () => {
      const parent = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Parent annotation'
      });

      const reply = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Reply annotation',
        parent_id: parent.id
      });

      expect(reply.parent_id).toBe(parent.id);
      expect(reply.status).toBe('replied');
    });

    it('should use custom author_type when provided', () => {
      const annotation = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Human annotation',
        author_type: 'human'
      });

      expect(annotation.author_type).toBe('human');
    });
  });

  describe('resolveAnnotation', () => {
    it('should resolve existing annotation', () => {
      const annotation = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = resolveAnnotation(annotation.id);

      expect(result.status).toBe('resolved');
      expect(result.annotation_id).toBe(annotation.id);

      // Verify annotation is actually resolved in database
      const resolved = listAnnotations('test-doc.md', undefined, 'resolved');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe(annotation.id);
    });

    it('should return error for non-existent annotation', () => {
      const result = resolveAnnotation('non-existent-id');

      expect(result.status).toBe('error');
      expect(result.message).toBe('Annotation not found');
    });
  });

  describe('submitReview', () => {
    it('should create review with specified annotation IDs', () => {
      const annotation1 = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'First annotation'
      });
      const annotation2 = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'conclusion',
        content: 'Second annotation'
      });

      const result = submitReview('test-doc.md', [annotation1.id, annotation2.id]);

      expect(result).toMatchObject({
        status: 'review_submitted',
        doc_path: 'test-doc.md',
        comment_count: 2
      });

      expect((result as any).review_id).toBeTruthy();
      expect((result as any).submitted_at).toBeTruthy();
      expect((result as any).comments).toHaveLength(2);
    });

    it('should include all draft/submitted annotations when no IDs specified', () => {
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'First annotation'
      });
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'conclusion',
        content: 'Second annotation'
      });

      const result = submitReview('test-doc.md');

      expect((result as any).comment_count).toBe(2);
    });

    it('should update annotation statuses to submitted', () => {
      const annotation = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      submitReview('test-doc.md', [annotation.id]);

      // Verify annotation status was updated
      const updated = listAnnotations('test-doc.md', undefined, 'submitted');
      expect(updated).toHaveLength(1);
      expect(updated[0].id).toBe(annotation.id);
    });
  });
});

describe('MCP Tool Authentication', () => {
  describe('Dev mode (no FOUNDRY_WRITE_TOKEN)', () => {
    beforeEach(() => {
      delete process.env.FOUNDRY_WRITE_TOKEN;
    });

    it('should allow list_annotations without auth_token', async () => {
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = await callMcpTool('list_annotations', {
        doc_path: 'test-doc.md'
      });

      expect(result.content).toBeDefined();
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
    });

    it('should allow create_annotation without auth_token', async () => {
      const result = await callMcpTool('create_annotation', {
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      expect(result.content).toBeDefined();
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('created');
      expect(data.annotation).toBeDefined();
    });

    it('should allow resolve_annotation without auth_token', async () => {
      const annotation = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = await callMcpTool('resolve_annotation', {
        annotation_id: annotation.id
      });

      expect(result.content).toBeDefined();
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('resolved');
    });

    it('should allow submit_review without auth_token', async () => {
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = await callMcpTool('submit_review', {
        doc_path: 'test-doc.md'
      });

      expect(result.content).toBeDefined();
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('review_submitted');
    });
  });

  describe('Production mode (FOUNDRY_WRITE_TOKEN set)', () => {
    beforeEach(() => {
      process.env.FOUNDRY_WRITE_TOKEN = 'test-secret-token';
    });

    it('should reject list_annotations without auth_token', async () => {
      const result = await callMcpTool('list_annotations', {
        doc_path: 'test-doc.md'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Authentication required. Provide a valid auth_token parameter.');
    });

    it('should reject list_annotations with invalid auth_token', async () => {
      const result = await callMcpTool('list_annotations', {
        doc_path: 'test-doc.md',
        auth_token: 'wrong-token'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Authentication required. Provide a valid auth_token parameter.');
    });

    it('should allow list_annotations with valid auth_token', async () => {
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = await callMcpTool('list_annotations', {
        doc_path: 'test-doc.md',
        auth_token: 'test-secret-token'
      });

      expect(result.content).toBeDefined();
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data).toHaveLength(1);
    });

    it('should reject create_annotation without auth_token', async () => {
      const result = await callMcpTool('create_annotation', {
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Authentication required. Provide a valid auth_token parameter.');
    });

    it('should allow create_annotation with valid auth_token', async () => {
      const result = await callMcpTool('create_annotation', {
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation',
        auth_token: 'test-secret-token'
      });

      expect(result.content).toBeDefined();
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('created');
    });

    it('should reject resolve_annotation without auth_token', async () => {
      const annotation = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = await callMcpTool('resolve_annotation', {
        annotation_id: annotation.id
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Authentication required. Provide a valid auth_token parameter.');
    });

    it('should allow resolve_annotation with valid auth_token', async () => {
      const annotation = createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = await callMcpTool('resolve_annotation', {
        annotation_id: annotation.id,
        auth_token: 'test-secret-token'
      });

      expect(result.content).toBeDefined();
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('resolved');
    });

    it('should reject submit_review without auth_token', async () => {
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = await callMcpTool('submit_review', {
        doc_path: 'test-doc.md'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Authentication required. Provide a valid auth_token parameter.');
    });

    it('should allow submit_review with valid auth_token', async () => {
      createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation'
      });

      const result = await callMcpTool('submit_review', {
        doc_path: 'test-doc.md',
        auth_token: 'test-secret-token'
      });

      expect(result.content).toBeDefined();
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('review_submitted');
    });
  });
});

describe('Search Tool (No Auth Required)', () => {
  beforeEach(() => {
    // Test both with and without FOUNDRY_WRITE_TOKEN to verify search is always public
    process.env.FOUNDRY_WRITE_TOKEN = 'test-secret-token';
  });

  it('should allow search_docs without auth_token when FOUNDRY_WRITE_TOKEN is set', async () => {
    const result = await callMcpTool('search_docs', {
      query: 'test search query'
    }, true);

    expect(result.content).toBeDefined();
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.results).toBeDefined();
    expect(data.query).toBe('test search query');
  });

  it('should allow search_docs without auth_token when FOUNDRY_WRITE_TOKEN is not set', async () => {
    delete process.env.FOUNDRY_WRITE_TOKEN;

    const result = await callMcpTool('search_docs', {
      query: 'test search query'
    }, true);

    expect(result.content).toBeDefined();
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.results).toBeDefined();
    expect(data.query).toBe('test search query');
  });

  it('should handle search with top_k parameter', async () => {
    const result = await callMcpTool('search_docs', {
      query: 'test search query',
      top_k: 5
    }, true);

    expect(result.content).toBeDefined();
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.results).toBeDefined();
    expect(data.totalResults).toBe(1); // Based on our mock
  });
});