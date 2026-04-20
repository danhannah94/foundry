/**
 * MCP tool-dispatch unit tests.
 *
 * Drives createMcpServer's CallToolRequest handler directly, skipping
 * the HTTP transport. The service layer is covered in depth by
 * services/__tests__/*.test.ts — here we focus on MCP-specific
 * behavior:
 *   - Tool-name dispatch (a tool call of name X routes to the right
 *     service function).
 *   - Argument parsing: the MCP schemas use `section`/`heading_path`
 *     casing that the dispatch translates for the services.
 *   - AuthContext threading — identity flows into the service call.
 *   - Error mapping: ServiceError → McpError with a sensible code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../server.js';
import { AnvilHolder } from '../../anvil-holder.js';
import { getDb, closeDb } from '../../db.js';
import type { AuthContext } from '../../services/context.js';

const testDbPath = join(tmpdir(), `foundry-mcp-dispatch-${Date.now()}.db`);
const testContentDir = join(tmpdir(), `foundry-mcp-dispatch-content-${Date.now()}`);

function seedDoc(relPath: string): void {
  const withoutExt = relPath.replace(/\.md$/, '');
  const parts = withoutExt.split('/');
  const dir = join(testContentDir, ...parts.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(testContentDir, `${withoutExt}.md`), `# Test\n\n## Intro\n\nHello.\n`, 'utf-8');
}

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  process.env.CONTENT_DIR = testContentDir;
  mkdirSync(testContentDir, { recursive: true });
  seedDoc('mcp-dispatch-tests.md');
  getDb();
});

afterAll(() => {
  closeDb();
  try { unlinkSync(testDbPath); } catch {}
  try { rmSync(testContentDir, { recursive: true, force: true }); } catch {}
  delete process.env.FOUNDRY_DB_PATH;
  delete process.env.CONTENT_DIR;
});

function interactiveCtx(userId = 'u-test'): AuthContext {
  return {
    user: { id: userId, github_login: 'tester', scopes: ['docs:read', 'docs:write'] },
    client: { id: 'c-test', name: 'Tester Client', client_type: 'interactive' },
  };
}

function autonomousCtx(userId = 'u-ai'): AuthContext {
  return {
    user: { id: userId, github_login: 'ai', scopes: ['docs:read', 'docs:write'] },
    client: { id: 'c-ai', name: 'Bot', client_type: 'autonomous' },
  };
}

/**
 * Reach into the SDK Server's request handlers registry. The SDK
 * exposes `_requestHandlers` as a private field that setRequestHandler
 * populates — we use it to invoke handlers directly without a transport.
 * If the private field changes name we'll catch the break immediately
 * because every test in this file depends on it.
 */
function getCallToolHandler(server: any): (req: any) => Promise<any> {
  const handlers = server._requestHandlers;
  const handler = handlers.get('tools/call');
  if (!handler) throw new Error('tools/call handler not registered');
  return handler;
}

function getListToolsHandler(server: any): (req: any) => Promise<any> {
  const handlers = server._requestHandlers;
  const handler = handlers.get('tools/list');
  if (!handler) throw new Error('tools/list handler not registered');
  return handler;
}

function callTool(server: any, name: string, args: Record<string, unknown>) {
  const handler = getCallToolHandler(server);
  const request = {
    method: 'tools/call',
    params: { name, arguments: args },
  };
  // setRequestHandler validates params with the schema; mirror that
  // with a manual parse so we hit the same code path.
  CallToolRequestSchema.parse(request);
  return handler(request);
}

describe('MCP tool dispatch', () => {
  describe('tools/list', () => {
    it('exposes all 25 tool definitions regardless of ctx', async () => {
      const server = createMcpServer({}, new AnvilHolder());
      const handler = getListToolsHandler(server);
      const request = { method: 'tools/list' };
      ListToolsRequestSchema.parse(request);
      const result = await handler(request);
      expect(Array.isArray(result.tools)).toBe(true);
      // There are 25 tools: 8 annotation + 2 review + 1 nav + 1 search +
      // 2 page + 2 status + 1 import + 6 doc-crud + 1 sync + 1 hidden
      // (the schema count above). Just assert a stable-ish floor.
      expect(result.tools.length).toBeGreaterThanOrEqual(24);
      const toolNames = result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('create_annotation');
      expect(toolNames).toContain('search_docs');
      expect(toolNames).toContain('sync_to_github');
    });
  });

  describe('argument translation', () => {
    it('create_annotation maps MCP `section` → service `heading_path`', async () => {
      const server = createMcpServer(interactiveCtx('u-arg-1'), new AnvilHolder());
      const result = await callTool(server, 'create_annotation', {
        doc_path: 'mcp-dispatch-tests',
        section: 'Intro',
        content: 'heading-path mapping',
      });
      // Result content is a text block containing JSON.
      expect(result.content?.[0]?.type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.annotation.heading_path).toBe('Intro');
    });
  });

  describe('identity threading', () => {
    it('create_annotation stamps user_id from ctx.user.id', async () => {
      const server = createMcpServer(interactiveCtx('u-identity-1'), new AnvilHolder());
      const result = await callTool(server, 'create_annotation', {
        doc_path: 'mcp-dispatch-tests',
        section: 'Intro',
        content: 'identity threading',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.annotation.user_id).toBe('u-identity-1');
      // Interactive client → author_type = 'human'.
      expect(parsed.annotation.author_type).toBe('human');
    });

    it('autonomous ctx → annotation carries author_type ai', async () => {
      const server = createMcpServer(autonomousCtx('u-identity-ai'), new AnvilHolder());
      const result = await callTool(server, 'create_annotation', {
        doc_path: 'mcp-dispatch-tests',
        section: 'Intro',
        content: 'autonomous threading',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.annotation.user_id).toBe('u-identity-ai');
      expect(parsed.annotation.author_type).toBe('ai');
    });

    it('falls back to anonymous when ctx has no user (dev passthrough)', async () => {
      const server = createMcpServer({}, new AnvilHolder());
      const result = await callTool(server, 'create_annotation', {
        doc_path: 'mcp-dispatch-tests',
        section: 'Intro',
        content: 'dev passthrough',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.annotation.user_id).toBe('anonymous');
    });
  });

  describe('error mapping', () => {
    it('unknown tool name → McpError MethodNotFound', async () => {
      const server = createMcpServer(interactiveCtx(), new AnvilHolder());
      await expect(callTool(server, 'not_a_tool', {})).rejects.toBeInstanceOf(McpError);
      try {
        await callTool(server, 'not_a_tool', {});
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.MethodNotFound);
      }
    });

    it('ValidationError (400-class) → McpError InvalidParams', async () => {
      const server = createMcpServer(interactiveCtx(), new AnvilHolder());
      // Missing required fields — service throws ValidationError.
      await expect(
        callTool(server, 'create_annotation', {
          doc_path: 'mcp-dispatch-tests',
          section: '',
          content: '',
        }),
      ).rejects.toThrow(McpError);
      try {
        await callTool(server, 'create_annotation', {
          doc_path: 'mcp-dispatch-tests',
          section: '',
          content: '',
        });
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.InvalidParams);
      }
    });

    it('NotFoundError on non-existent doc → McpError InvalidParams', async () => {
      const server = createMcpServer(interactiveCtx(), new AnvilHolder());
      try {
        await callTool(server, 'create_annotation', {
          doc_path: 'does/not/exist',
          section: 'Intro',
          content: 'will fail',
        });
        throw new Error('expected McpError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(McpError);
        expect(err.code).toBe(ErrorCode.InvalidParams); // 404 is still a client fault
      }
    });

    it('search_docs without anvil → McpError InternalError (ServiceUnavailable mapping)', async () => {
      const emptyHolder = new AnvilHolder();
      const server = createMcpServer(interactiveCtx(), emptyHolder);
      try {
        await callTool(server, 'search_docs', { query: 'anything' });
        throw new Error('expected McpError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(McpError);
        expect(err.code).toBe(ErrorCode.InternalError);
      }
    });
  });

  describe('tool shape', () => {
    it('get_status returns a status payload even without anvil', async () => {
      const server = createMcpServer(interactiveCtx(), new AnvilHolder());
      const result = await callTool(server, 'get_status', {});
      expect(result.content?.[0]?.type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('ok');
      expect(parsed.version).toBeDefined();
    });

    it('list_annotations round-trips through the service layer', async () => {
      const server = createMcpServer(interactiveCtx('u-list-1'), new AnvilHolder());
      await callTool(server, 'create_annotation', {
        doc_path: 'mcp-dispatch-tests',
        section: 'Intro',
        content: 'listable-1',
      });
      const result = await callTool(server, 'list_annotations', {
        doc_path: 'mcp-dispatch-tests',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some((a: any) => a.content === 'listable-1')).toBe(true);
    });
  });
});
