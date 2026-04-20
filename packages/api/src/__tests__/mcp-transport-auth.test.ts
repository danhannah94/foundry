import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireAuth } from '../middleware/auth.js';
import { createMcpServer } from '../mcp/server.js';
import { AnvilHolder } from '../anvil-holder.js';
import { getDb, closeDb } from '../db.js';

/**
 * Integration test for the MCP Streamable HTTP mount (S10b).
 *
 * Mirrors the mount pattern in index.ts — requireAuth → per-request
 * Server + StreamableHTTPServerTransport pair → handleRequest. The real
 * production mount is defined inline in startServer() and not directly
 * importable without booting the full server, so this test rebuilds the
 * same shape in-process.
 *
 * Key assertions (S10b acceptance criteria):
 *   - 401 + WWW-Authenticate when the caller is unauthenticated.
 *   - The FOUNDRY_MCP_REQUIRE_AUTH escape hatch from S7 is gone —
 *     setting it to 'false' has no effect on the auth gate.
 *   - Identity propagates through MCP: an authenticated create_annotation
 *     tool call persists with user_id = req.user.id.
 */

const testDbPath = join(tmpdir(), `foundry-mcp-transport-auth-${Date.now()}.db`);
const testContentDir = join(tmpdir(), `foundry-mcp-transport-auth-content-${Date.now()}`);

function seedDoc(relPath: string): void {
  const withoutExt = relPath.replace(/\.md$/, '');
  const parts = withoutExt.split('/');
  const dir = join(testContentDir, ...parts.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(testContentDir, `${withoutExt}.md`), `# Test\n`, 'utf-8');
}

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  process.env.CONTENT_DIR = testContentDir;
  mkdirSync(testContentDir, { recursive: true });
  seedDoc('mcp/transport-auth-tests.md');
  getDb();
});

afterAll(() => {
  closeDb();
  try { unlinkSync(testDbPath); } catch {}
  try { rmSync(testContentDir, { recursive: true, force: true }); } catch {}
  delete process.env.FOUNDRY_DB_PATH;
  delete process.env.CONTENT_DIR;
});

/**
 * Build the same app shape index.ts mounts at /mcp — requireAuth gates,
 * handler spins up a Server + StreamableHTTPServerTransport per request.
 * The anvilHolder is intentionally left uninitialised; tool calls that
 * don't need anvil (annotations, etc.) still work.
 */
function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  const anvilHolder = new AnvilHolder();

  app.post('/mcp', requireAuth, async (req, res) => {
    const ctx = { user: req.user, client: req.client };
    const mcpServer = createMcpServer(ctx, anvilHolder);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      transport.close();
      mcpServer.close();
    });
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });
  const methodNotAllowed: express.RequestHandler = (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  };
  app.get('/mcp', requireAuth, methodNotAllowed);
  app.delete('/mcp', requireAuth, methodNotAllowed);

  return app;
}

// Build a Streamable HTTP `initialize` JSON-RPC message — needed as the
// first (and in stateless mode, the only-per-request) message before the
// transport will accept tool calls.
function initMessage(id: number | string) {
  return {
    jsonrpc: '2.0' as const,
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' },
    },
  };
}

describe('MCP Streamable HTTP transport (S10b)', () => {
  let app: express.Express;
  let originalWriteToken: string | undefined;
  let originalRequireAuth: string | undefined;

  beforeEach(() => {
    originalWriteToken = process.env.FOUNDRY_WRITE_TOKEN;
    originalRequireAuth = process.env.FOUNDRY_MCP_REQUIRE_AUTH;
    process.env.FOUNDRY_WRITE_TOKEN = 'mcp-test-token';
    app = buildApp();
  });

  afterEach(() => {
    if (originalWriteToken === undefined) delete process.env.FOUNDRY_WRITE_TOKEN;
    else process.env.FOUNDRY_WRITE_TOKEN = originalWriteToken;

    if (originalRequireAuth === undefined) delete process.env.FOUNDRY_MCP_REQUIRE_AUTH;
    else process.env.FOUNDRY_MCP_REQUIRE_AUTH = originalRequireAuth;
  });

  describe('auth gate', () => {
    it('returns 401 + WWW-Authenticate on unauthenticated POST /mcp', async () => {
      const res = await request(app).post('/mcp').send(initMessage(1));
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
      expect(res.headers['www-authenticate']).toContain('resource_metadata=');
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 with an invalid Bearer token', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer wrong-token')
        .send(initMessage(1));
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
    });

    it('returns 401 on GET /mcp without auth', async () => {
      const res = await request(app).get('/mcp');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
    });

    it('accepts a valid Bearer token and completes the initialize handshake', async () => {
      // StreamableHTTPServerTransport returns an SSE stream by default;
      // supertest collects the body and the initialize response is in the
      // SSE data payload. A 2xx status means the transport started.
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer mcp-test-token')
        .set('Accept', 'application/json, text/event-stream')
        .send(initMessage(1));
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      // The initialize response must reference the same id we sent.
      const bodyStr = res.text || '';
      expect(bodyStr).toContain('"id":1');
      expect(bodyStr).toMatch(/"result"/);
    });
  });

  describe('regression: FOUNDRY_MCP_REQUIRE_AUTH escape hatch is gone', () => {
    it('still 401s unauth requests when FOUNDRY_MCP_REQUIRE_AUTH=false', async () => {
      process.env.FOUNDRY_MCP_REQUIRE_AUTH = 'false';
      // Rebuild app in case the mount were to read the env at mount time
      // (it doesn't in S10b — we want to lock that in).
      const localApp = buildApp();
      const res = await request(localApp).post('/mcp').send(initMessage(1));
      expect(res.status).toBe(401);
    });

    it('still requires auth even when FOUNDRY_MCP_REQUIRE_AUTH=false is set mid-session', async () => {
      process.env.FOUNDRY_MCP_REQUIRE_AUTH = 'false';
      const res = await request(app).post('/mcp').send(initMessage(1));
      expect(res.status).toBe(401);
    });
  });

  describe('identity propagation through MCP', () => {
    it('persists user_id = req.user.id on an authed create_annotation tool call', async () => {
      // In stateless Streamable mode (sessionIdGenerator: undefined),
      // validateSession skips the _initialized gate — a bare tools/call
      // is accepted on a fresh transport instance. We rely on that so
      // each test is a single request with zero handshake noise.
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer mcp-test-token')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 'call-1',
          method: 'tools/call',
          params: {
            name: 'create_annotation',
            arguments: {
              doc_path: 'mcp/transport-auth-tests',
              section: 'Test',
              content: 'identity-propagation-check',
            },
          },
        });

      expect(res.status).toBeLessThan(300);
      expect(res.text).toContain('"id":"call-1"');
      expect(res.text).toContain('"result"');

      // Assert the DB row carries user_id === 'legacy' (the id stamped by
      // requireAuth on a FOUNDRY_WRITE_TOKEN match — see
      // middleware/auth.ts:resolveBearerToken legacy branch).
      const db = getDb();
      const row = db
        .prepare(
          `SELECT user_id, author_type FROM annotations
           WHERE doc_path = ? AND content = ?`,
        )
        .get('mcp/transport-auth-tests', 'identity-propagation-check') as
        | { user_id: string; author_type: string }
        | undefined;
      expect(row).toBeDefined();
      expect(row?.user_id).toBe('legacy');
      // Legacy bearer resolves to an autonomous client → author_type = 'ai'.
      expect(row?.author_type).toBe('ai');
    });
  });
});
