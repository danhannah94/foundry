import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../middleware/auth.js';

/**
 * Integration test for MCP transport auth (issue #105).
 *
 * The real /mcp/sse and /mcp/message endpoints are defined inline in
 * startServer() in index.ts, which cannot be imported without booting the
 * full server. These tests mirror the exact mount pattern used in index.ts
 * (`requireAuth` -> handler) and verify that the transport endpoints reject
 * unauthenticated requests before any MCP work happens.
 *
 * If the mount pattern in index.ts drifts (e.g. requireAuth is removed or
 * moved), this test becomes a smoke test for the auth surface — not a direct
 * binding to the real handlers. The grep-safe guarantee is the edit in
 * index.ts, this test locks in the middleware contract.
 */
describe('MCP transport auth (issue #105)', () => {
  let app: express.Express;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.FOUNDRY_WRITE_TOKEN;
    process.env.FOUNDRY_WRITE_TOKEN = 'mcp-test-token';

    app = express();
    app.use(express.json());

    // Mirror index.ts: requireAuth runs before the MCP transport handlers.
    // We stub the handlers with minimal responses that match the real shape.
    app.get('/mcp/sse', requireAuth, (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      // Simulate the SSE handshake the real SSEServerTransport would send.
      res.write('event: endpoint\ndata: /mcp/message?sessionId=test\n\n');
      res.end();
    });

    app.post('/mcp/message', requireAuth, (req, res) => {
      const sessionId = req.query.sessionId as string | undefined;
      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
      }
      // Real handler would dispatch to the MCP transport; for auth tests
      // we only care that the request made it past requireAuth.
      res.status(200).end();
    });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FOUNDRY_WRITE_TOKEN;
    } else {
      process.env.FOUNDRY_WRITE_TOKEN = originalEnv;
    }
  });

  describe('GET /mcp/sse', () => {
    it('returns 401 without an Authorization header', async () => {
      const res = await request(app).get('/mcp/sse').expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 with an invalid Bearer token', async () => {
      const res = await request(app)
        .get('/mcp/sse')
        .set('Authorization', 'Bearer wrong-token')
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 200 and starts the SSE stream with a valid Bearer token', async () => {
      const res = await request(app)
        .get('/mcp/sse')
        .set('Authorization', 'Bearer mcp-test-token')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('event: endpoint');
    });
  });

  describe('POST /mcp/message', () => {
    it('returns 401 without an Authorization header', async () => {
      const res = await request(app)
        .post('/mcp/message?sessionId=foo')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('returns 401 with an invalid Bearer token', async () => {
      const res = await request(app)
        .post('/mcp/message?sessionId=foo')
        .set('Authorization', 'Bearer wrong-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('passes through to the handler with a valid Bearer token', async () => {
      await request(app)
        .post('/mcp/message?sessionId=foo')
        .set('Authorization', 'Bearer mcp-test-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(200);
    });
  });

  describe('dev mode (FOUNDRY_WRITE_TOKEN unset)', () => {
    it('allows /mcp/sse through when token is not configured', async () => {
      delete process.env.FOUNDRY_WRITE_TOKEN;
      await request(app).get('/mcp/sse').expect(200);
    });

    it('allows /mcp/message through when token is not configured', async () => {
      delete process.env.FOUNDRY_WRITE_TOKEN;
      await request(app)
        .post('/mcp/message?sessionId=foo')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        .expect(200);
    });
  });
});
