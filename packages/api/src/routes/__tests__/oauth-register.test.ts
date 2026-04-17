import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import { getDb, closeDb } from '../../db.js';
import { createOauthRegisterRouter } from '../oauth-register.js';

// ─── DB helpers ───────────────────────────────────────────────────────────────

const testDbPath = join(tmpdir(), `foundry-oauth-register-test-${process.pid}-${Date.now()}.db`);

// Token used in all happy-path / wrong-token tests
const DCR_TOKEN = 'test-dcr-token-48-chars-long-xxxxxxxxxxxxxxxxxxxx';

let app: express.Express;

beforeEach(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  process.env.FOUNDRY_DCR_TOKEN = DCR_TOKEN;
  closeDb();
  getDb(); // trigger schema creation

  app = express();
  app.use(express.json());
  app.use('/', createOauthRegisterRouter());

  // Minimal error handler so 500s from thrown errors return JSON
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? 'Internal server error' });
  });
});

afterEach(() => {
  closeDb();
  try {
    unlinkSync(testDbPath);
  } catch {
    // ignore
  }
  delete process.env.FOUNDRY_DB_PATH;
  delete process.env.FOUNDRY_DCR_TOKEN;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validBody() {
  return {
    client_name: 'Claude.ai Connector',
    redirect_uris: ['https://claude.ai/oauth/callback'],
    client_type: 'autonomous',
  };
}

function authed() {
  return request(app)
    .post('/oauth/register')
    .set('Authorization', `Bearer ${DCR_TOKEN}`)
    .set('Content-Type', 'application/json');
}

// ─── Bearer gate ──────────────────────────────────────────────────────────────

describe('POST /oauth/register — bearer gate', () => {
  it('returns 401 invalid_token when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/oauth/register')
      .send(validBody())
      .expect(401);

    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 401 invalid_token when bearer token is wrong', async () => {
    const res = await request(app)
      .post('/oauth/register')
      .set('Authorization', 'Bearer wrong-token')
      .send(validBody())
      .expect(401);

    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 401 for a token that is the right length but wrong value', async () => {
    // Same length, different content
    const sameLength = 'X'.repeat(DCR_TOKEN.length);
    const res = await request(app)
      .post('/oauth/register')
      .set('Authorization', `Bearer ${sameLength}`)
      .send(validBody())
      .expect(401);

    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 500 when FOUNDRY_DCR_TOKEN is unset (misconfiguration)', async () => {
    delete process.env.FOUNDRY_DCR_TOKEN;

    const res = await request(app)
      .post('/oauth/register')
      .set('Authorization', `Bearer ${DCR_TOKEN}`)
      .send(validBody())
      .expect(500);

    // Error body shouldn't leak the internal message to production, but our
    // test error handler does echo it — just assert it's a 500, not an RFC code
    expect(res.body.error).toBeTruthy();
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('POST /oauth/register — happy path', () => {
  it('returns 201 with client_id, client_secret, and echoed fields', async () => {
    const res = await authed().send(validBody()).expect(201);

    expect(res.body.client_id).toBeTruthy();
    expect(res.body.client_secret).toBeTruthy();
    expect(res.body.client_name).toBe('Claude.ai Connector');
    expect(res.body.redirect_uris).toEqual(['https://claude.ai/oauth/callback']);
    expect(res.body.client_type).toBe('autonomous');
    expect(res.body.registration_access_token).toBeNull();
  });

  it('client_id is a non-empty string', async () => {
    const res = await authed().send(validBody()).expect(201);
    expect(typeof res.body.client_id).toBe('string');
    expect(res.body.client_id.length).toBeGreaterThan(0);
  });

  it('client_secret is a non-empty string', async () => {
    const res = await authed().send(validBody()).expect(201);
    expect(typeof res.body.client_secret).toBe('string');
    expect(res.body.client_secret.length).toBeGreaterThan(0);
  });

  it('two registrations produce different credentials', async () => {
    const res1 = await authed().send(validBody()).expect(201);
    const res2 = await authed().send(validBody()).expect(201);

    expect(res1.body.client_id).not.toBe(res2.body.client_id);
    expect(res1.body.client_secret).not.toBe(res2.body.client_secret);
  });

  it('accepts http://localhost:3000/callback as a valid redirect_uri', async () => {
    const body = {
      ...validBody(),
      redirect_uris: ['http://localhost:3000/callback'],
    };
    const res = await authed().send(body).expect(201);
    expect(res.body.redirect_uris).toEqual(['http://localhost:3000/callback']);
  });

  it('accepts http://localhost (no port, no path)', async () => {
    const body = { ...validBody(), redirect_uris: ['http://localhost'] };
    const res = await authed().send(body).expect(201);
    expect(res.body.redirect_uris).toEqual(['http://localhost']);
  });

  it('accepts multiple redirect_uris', async () => {
    const uris = ['https://example.com/cb', 'https://other.example.com/cb'];
    const body = { ...validBody(), redirect_uris: uris };
    const res = await authed().send(body).expect(201);
    expect(res.body.redirect_uris).toEqual(uris);
  });

  it('accepts optional grant_types when authorization_code is included', async () => {
    const body = { ...validBody(), grant_types: ['authorization_code', 'refresh_token'] };
    const res = await authed().send(body).expect(201);
    expect(res.body.client_id).toBeTruthy();
  });

  it('accepts optional response_types without error', async () => {
    const body = { ...validBody(), response_types: ['code'] };
    const res = await authed().send(body).expect(201);
    expect(res.body.client_id).toBeTruthy();
  });

  it('accepts optional token_endpoint_auth_method without error', async () => {
    const body = { ...validBody(), token_endpoint_auth_method: 'client_secret_basic' };
    const res = await authed().send(body).expect(201);
    expect(res.body.client_id).toBeTruthy();
  });
});

// ─── client_name validation ───────────────────────────────────────────────────

describe('POST /oauth/register — client_name validation', () => {
  it('returns 400 invalid_client_metadata when client_name is missing', async () => {
    const { client_name: _, ...body } = validBody();
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_client_metadata');
    expect(res.body.error_description).toMatch(/client_name/);
  });

  it('returns 400 invalid_client_metadata when client_name exceeds 100 chars', async () => {
    const body = { ...validBody(), client_name: 'A'.repeat(101) };
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_client_metadata');
    expect(res.body.error_description).toMatch(/client_name/);
  });

  it('accepts client_name at exactly 100 chars', async () => {
    const body = { ...validBody(), client_name: 'B'.repeat(100) };
    const res = await authed().send(body).expect(201);
    expect(res.body.client_name).toBe('B'.repeat(100));
  });
});

// ─── redirect_uris validation ─────────────────────────────────────────────────

describe('POST /oauth/register — redirect_uris validation', () => {
  it('returns 400 invalid_client_metadata when redirect_uris is missing', async () => {
    const { redirect_uris: _, ...body } = validBody();
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_client_metadata');
    expect(res.body.error_description).toMatch(/redirect_uris/);
  });

  it('returns 400 invalid_redirect_uri when redirect_uris is empty array', async () => {
    const body = { ...validBody(), redirect_uris: [] };
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  it('returns 400 invalid_redirect_uri for http://evil.com (non-https, non-localhost)', async () => {
    const body = { ...validBody(), redirect_uris: ['http://evil.com'] };
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  it('returns 400 invalid_redirect_uri for ftp:// URI', async () => {
    const body = { ...validBody(), redirect_uris: ['ftp://example.com/cb'] };
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_redirect_uri');
  });

  it('returns 400 invalid_redirect_uri if any URI in the array is invalid', async () => {
    const body = {
      ...validBody(),
      redirect_uris: ['https://ok.example.com/cb', 'http://not-localhost.com/cb'],
    };
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_redirect_uri');
  });
});

// ─── client_type validation ───────────────────────────────────────────────────

describe('POST /oauth/register — client_type validation', () => {
  it('returns 400 invalid_client_metadata when client_type is missing', async () => {
    const { client_type: _, ...body } = validBody();
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_client_metadata');
    expect(res.body.error_description).toMatch(/client_type/);
  });

  it('returns 400 invalid_client_metadata for unsupported client_type "bot"', async () => {
    const body = { ...validBody(), client_type: 'bot' };
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_client_metadata');
  });

  it('accepts client_type "interactive"', async () => {
    const body = { ...validBody(), client_type: 'interactive' };
    const res = await authed().send(body).expect(201);
    expect(res.body.client_type).toBe('interactive');
  });

  it('accepts client_type "autonomous"', async () => {
    const body = { ...validBody(), client_type: 'autonomous' };
    const res = await authed().send(body).expect(201);
    expect(res.body.client_type).toBe('autonomous');
  });
});

// ─── grant_types validation ───────────────────────────────────────────────────

describe('POST /oauth/register — grant_types validation', () => {
  it('returns 400 invalid_client_metadata when grant_types lacks authorization_code', async () => {
    const body = { ...validBody(), grant_types: ['client_credentials'] };
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_client_metadata');
  });

  it('returns 400 when grant_types is an empty array', async () => {
    const body = { ...validBody(), grant_types: [] };
    const res = await authed().send(body).expect(400);

    expect(res.body.error).toBe('invalid_client_metadata');
  });
});
