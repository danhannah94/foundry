import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../auth.js';

describe('requireAuth middleware', () => {
  let app: express.Express;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original env
    originalEnv = process.env.FOUNDRY_WRITE_TOKEN;
    
    // Create fresh app for each test
    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.FOUNDRY_WRITE_TOKEN;
    } else {
      process.env.FOUNDRY_WRITE_TOKEN = originalEnv;
    }
  });

  it('should allow requests when FOUNDRY_WRITE_TOKEN is not set (dev mode)', async () => {
    delete process.env.FOUNDRY_WRITE_TOKEN;
    
    app.use('/protected', requireAuth);
    app.get('/protected', (req, res) => res.json({ success: true }));

    const res = await request(app)
      .get('/protected')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should return 401 when no Authorization header is provided and token is set', async () => {
    process.env.FOUNDRY_WRITE_TOKEN = 'test-token';
    
    app.use('/protected', requireAuth);
    app.get('/protected', (req, res) => res.json({ success: true }));

    const res = await request(app)
      .get('/protected')
      .expect(401);

    expect(res.body.error).toBe('Unauthorized');
  });

  it('should return 401 when wrong token is provided', async () => {
    process.env.FOUNDRY_WRITE_TOKEN = 'correct-token';
    
    app.use('/protected', requireAuth);
    app.get('/protected', (req, res) => res.json({ success: true }));

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer wrong-token')
      .expect(401);

    expect(res.body.error).toBe('Unauthorized');
  });

  it('should allow request when valid Bearer token is provided', async () => {
    process.env.FOUNDRY_WRITE_TOKEN = 'correct-token';
    
    app.use('/protected', requireAuth);
    app.get('/protected', (req, res) => res.json({ success: true }));

    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer correct-token')
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('should read Authorization header on SSE-style GET requests (issue #105)', async () => {
    // SSE is just a long-lived GET — Express middleware runs on the initial
    // request before the response is upgraded to a stream. Verify that
    // req.headers.authorization is readable in that context.
    process.env.FOUNDRY_WRITE_TOKEN = 'sse-token';

    app.get('/sse', requireAuth, (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write('data: hello\n\n');
      res.end();
    });

    // Without auth — should 401 before the stream starts
    await request(app)
      .get('/sse')
      .expect(401);

    // With valid auth — should get through and receive the stream payload
    const ok = await request(app)
      .get('/sse')
      .set('Authorization', 'Bearer sse-token')
      .expect(200);

    expect(ok.text).toContain('data: hello');
  });

  it('should return 401 when Authorization header has malformed format', async () => {
    process.env.FOUNDRY_WRITE_TOKEN = 'test-token';
    
    app.use('/protected', requireAuth);
    app.get('/protected', (req, res) => res.json({ success: true }));

    // Test various malformed headers
    const malformedHeaders = [
      'Basic test-token',           // Wrong auth type
      'Bearer',                     // Missing token
      'test-token',                 // No "Bearer " prefix  
      'Bearer  test-token',         // Double space
    ];

    for (const header of malformedHeaders) {
      const res = await request(app)
        .get('/protected')
        .set('Authorization', header)
        .expect(401);

      expect(res.body.error).toBe('Unauthorized');
    }
  });
});