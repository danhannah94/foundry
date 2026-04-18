/**
 * Tests for FND-E12-S5: GET /oauth/authorize + POST /oauth/consent
 *
 * Strategy:
 * - Real DB (temp SQLite) for clientsDao, codesDao, usersDao — no DAO stubs.
 * - vi.spyOn(global, 'fetch') only for outbound GitHub HTTP calls.
 * - signCookie / verifyCookie used directly to craft and inspect cookies.
 */

// ─── Env must be set before any module import ──────────────────────────────
process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.test';
process.env.FOUNDRY_OAUTH_SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';
process.env.GITHUB_OAUTH_CLIENT_ID = 'test-gh-client-id';
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-gh-client-secret';
process.env.FOUNDRY_PRIVATE_DOC_USERS = '';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';

import { createOauthRouter } from '../oauth.js';
import { signCookie } from '../../oauth/session.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, usersDao } from '../../oauth/dao.js';

// ─── DB setup ──────────────────────────────────────────────────────────────

const testDbPath = join(tmpdir(), `foundry-oauth-authorize-test-${process.pid}-${Date.now()}.db`);

let app: express.Express;

// ─── Seed data ─────────────────────────────────────────────────────────────

let clientId: string;
const REDIRECT_URI = 'https://claude.ai/oauth/callback';

// A valid PKCE S256 code challenge (43 url-safe chars)
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function validAuthorizeParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'docs:read',
    state: 'test-state-xyz',
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  };
}

// Build a signed session cookie with a given user_id
function makeSessionCookie(userId: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return signCookie({ user_id: userId, scopes: ['docs:read', 'docs:write'], exp });
}

// Build a signed pending OAuth cookie
function makePendingCookie(overrides: Record<string, unknown> = {}): string {
  const exp = Math.floor(Date.now() / 1000) + 600;
  return signCookie({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'docs:read',
    state: 'test-state-xyz',
    code_challenge: CODE_CHALLENGE,
    exp,
    ...overrides,
  });
}

// Parse a named cookie from a set-cookie header array
function extractCookie(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers['set-cookie'];
  const list: string[] = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  const entry = list.find(c => c.startsWith(`${name}=`));
  if (!entry) return undefined;
  return decodeURIComponent(entry.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? '');
}

// ─── Mock fetch helper ──────────────────────────────────────────────────────

function mockFetch(responses: Array<{ ok: boolean; status?: number; json?: object }>) {
  let i = 0;
  return vi.spyOn(global, 'fetch').mockImplementation(async () => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? 'OK' : 'Error',
      json: async () => r.json ?? {},
    } as Response;
  });
}

// ─── App + DB bootstrap ────────────────────────────────────────────────────

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  closeDb();
  getDb(); // creates schema

  app = express();
  app.use(express.json());
  app.use('/', createOauthRouter());

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? 'internal error' });
  });

  // Register a test client
  const { id } = clientsDao.register({
    name: 'Claude.ai Connector',
    redirect_uris: REDIRECT_URI,
    client_type: 'autonomous',
  });
  clientId = id;
});

afterAll(() => {
  closeDb();
  try { unlinkSync(testDbPath); } catch { /* ignore */ }
  delete process.env.FOUNDRY_DB_PATH;
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /oauth/authorize
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /oauth/authorize — validation', () => {
  it('returns 400 when client_id is missing', async () => {
    const { client_id: _, ...params } = validAuthorizeParams();
    const res = await request(app).get('/oauth/authorize').query(params).expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 when redirect_uri is missing', async () => {
    const { redirect_uri: _, ...params } = validAuthorizeParams();
    const res = await request(app).get('/oauth/authorize').query(params).expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 for unknown client_id (not a redirect)', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ client_id: 'unknown-client-id' }))
      .expect(400);
    expect(res.body.error).toBe('invalid_client');
    // Must NOT be a redirect — verify no Location header pointing to redirect_uri
    expect(res.headers.location ?? '').not.toContain(REDIRECT_URI);
  });

  it('returns 400 for mismatched redirect_uri (not a redirect)', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ redirect_uri: 'https://evil.example.com/callback' }))
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/redirect_uri/i);
    // Must NOT redirect anywhere
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('returns 400 for unsupported response_type', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ response_type: 'token' }))
      .expect(400);
    expect(res.body.error).toBe('unsupported_response_type');
  });

  it('returns 400 for code_challenge_method != S256', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ code_challenge_method: 'plain' }))
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/S256/);
  });

  it('returns 400 for code_challenge shorter than 43 chars', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ code_challenge: 'tooshort' }))
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/code_challenge/);
  });

  it('returns 400 for invalid_scope (unsupported scope value)', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ scope: 'docs:read admin:write' }))
      .expect(400);
    expect(res.body.error).toBe('invalid_scope');
    expect(res.body.error_description).toMatch(/admin:write/);
  });

  it('returns 400 for empty scope', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ scope: ' ' }))
      .expect(400);
    expect(res.body.error).toMatch(/invalid_scope|invalid_request/);
  });
});

describe('GET /oauth/authorize — no session → 302 to GitHub', () => {
  it('redirects to GitHub when no session cookie is present', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams())
      .expect(302);

    expect(res.headers.location).toContain('https://github.com/login/oauth/authorize');
    expect(res.headers.location).toContain('client_id=test-gh-client-id');
  });

  it('sets the oauth_pending signed cookie', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams())
      .expect(302);

    const pending = extractCookie(res.headers, 'foundry_oauth_pending');
    expect(pending).toBeDefined();
    // It must be a valid signed cookie (two base64url segments joined by .)
    expect(pending).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('sets the state cookie for the GitHub leg', async () => {
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams())
      .expect(302);

    const state = extractCookie(res.headers, 'foundry_oauth_state');
    expect(state).toBeDefined();
  });
});

describe('GET /oauth/authorize — with valid session → consent page', () => {
  let testUserId: string;

  beforeAll(() => {
    // Create a real user in the DB
    const user = usersDao.upsert({ github_login: 'test-consent-user', github_id: 12345 });
    testUserId = user.id;
  });

  it('renders HTML consent page when user session exists', async () => {
    const sessionCookie = makeSessionCookie(testUserId);
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams())
      .set('Cookie', `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Claude.ai Connector');
    expect(res.text).toContain('test-consent-user');
    expect(res.text).toContain('Read public docs');
    expect(res.text).toContain('Approve');
    expect(res.text).toContain('Deny');
  });

  it('renders multiple scopes in plain language', async () => {
    const sessionCookie = makeSessionCookie(testUserId);
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ scope: 'docs:read docs:write' }))
      .set('Cookie', `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`)
      .expect(200);

    expect(res.text).toContain('Read public docs');
    expect(res.text).toContain('Write annotations');
  });

  it('sets the pending cookie even when session exists', async () => {
    const sessionCookie = makeSessionCookie(testUserId);
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams())
      .set('Cookie', `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`)
      .expect(200);

    const pending = extractCookie(res.headers, 'foundry_oauth_pending');
    expect(pending).toBeDefined();
  });

  it('falls back to GitHub redirect when session user_id not found in DB', async () => {
    // Use a session with a non-existent user_id
    const sessionCookie = makeSessionCookie('non-existent-user-id-xyz');
    const res = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams())
      .set('Cookie', `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`)
      .expect(302);

    expect(res.headers.location).toContain('github.com');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /oauth/consent
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /oauth/consent — validation', () => {
  let userId: string;

  beforeAll(() => {
    const user = usersDao.upsert({ github_login: 'consent-test-user', github_id: 54321 });
    userId = user.id;
  });

  it('returns 400 when session cookie is missing', async () => {
    const pendingCookie = makePendingCookie();
    const res = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', `foundry_oauth_pending=${encodeURIComponent(pendingCookie)}`)
      .send('action=approve')
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 when pending cookie is missing', async () => {
    const sessionCookie = makeSessionCookie(userId);
    const res = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`)
      .send('action=approve')
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 when session cookie is expired', async () => {
    const expiredSession = makeSessionCookie(userId, -1);
    const pendingCookie = makePendingCookie();
    const res = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(expiredSession)}`,
        `foundry_oauth_pending=${encodeURIComponent(pendingCookie)}`,
      ].join('; '))
      .send('action=approve')
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/invalid or expired/i);
  });

  it('returns 400 when pending cookie is expired', async () => {
    const sessionCookie = makeSessionCookie(userId);
    const expiredPending = makePendingCookie({ exp: Math.floor(Date.now() / 1000) - 1 });
    const res = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`,
        `foundry_oauth_pending=${encodeURIComponent(expiredPending)}`,
      ].join('; '))
      .send('action=approve')
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/invalid or expired/i);
  });

  it('returns 400 for unknown action value', async () => {
    const sessionCookie = makeSessionCookie(userId);
    const pendingCookie = makePendingCookie();
    const res = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`,
        `foundry_oauth_pending=${encodeURIComponent(pendingCookie)}`,
      ].join('; '))
      .send('action=maybe')
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });
});

describe('POST /oauth/consent — deny', () => {
  let userId: string;

  beforeAll(() => {
    const user = usersDao.upsert({ github_login: 'deny-test-user', github_id: 65432 });
    userId = user.id;
  });

  it('redirects to redirect_uri with error=access_denied', async () => {
    const sessionCookie = makeSessionCookie(userId);
    const pendingCookie = makePendingCookie({ state: 'deny-state-001' });

    const res = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`,
        `foundry_oauth_pending=${encodeURIComponent(pendingCookie)}`,
      ].join('; '))
      .send('action=deny')
      .expect(302);

    expect(res.headers.location).toContain(`${REDIRECT_URI}?`);
    expect(res.headers.location).toContain('error=access_denied');
    expect(res.headers.location).toContain('state=deny-state-001');
  });
});

describe('POST /oauth/consent — approve (happy path)', () => {
  let userId: string;

  beforeAll(() => {
    const user = usersDao.upsert({ github_login: 'approve-test-user', github_id: 76543 });
    userId = user.id;
  });

  it('redirects to redirect_uri with code and state', async () => {
    const sessionCookie = makeSessionCookie(userId);
    const pendingCookie = makePendingCookie({ state: 'approve-state-001' });

    const res = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`,
        `foundry_oauth_pending=${encodeURIComponent(pendingCookie)}`,
      ].join('; '))
      .send('action=approve')
      .expect(302);

    const location = res.headers.location as string;
    expect(location).toContain(`${REDIRECT_URI}?`);
    expect(location).toContain('state=approve-state-001');

    const url = new URL(location);
    const code = url.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(typeof code).toBe('string');
    expect(code!.length).toBeGreaterThan(0);
  });

  it('mints a code that is retrievable from the DB', async () => {
    const sessionCookie = makeSessionCookie(userId);
    const pendingCookie = makePendingCookie({ state: 'db-check-state' });

    const res = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`,
        `foundry_oauth_pending=${encodeURIComponent(pendingCookie)}`,
      ].join('; '))
      .send('action=approve')
      .expect(302);

    const url = new URL(res.headers.location as string);
    const code = url.searchParams.get('code')!;

    const db = getDb();
    const row = db
      .prepare('SELECT * FROM oauth_authorization_codes WHERE code = ?')
      .get(code) as any;

    expect(row).toBeDefined();
    expect(row.user_id).toBe(userId);
    expect(row.client_id).toBe(clientId);
    expect(row.scope).toBe('docs:read');
    expect(row.redirect_uri).toBe(REDIRECT_URI);
    expect(row.pkce_challenge).toBe(CODE_CHALLENGE);
    expect(row.consumed_at).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Full happy-path flow: authorize (no session) → GitHub callback → consent
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full flow: GET /oauth/authorize with no session → GitHub → consent', () => {
  it('authorize redirects to GitHub, callback sets session, consent mints code', async () => {
    // Step 1: GET /oauth/authorize — no session → GitHub redirect
    const authRes = await request(app)
      .get('/oauth/authorize')
      .query(validAuthorizeParams({ state: 'flow-test-state' }))
      .expect(302);

    expect(authRes.headers.location).toContain('github.com');

    // Pending cookie set
    const pendingValue = extractCookie(authRes.headers, 'foundry_oauth_pending');
    expect(pendingValue).toBeDefined();

    // State cookie set
    const stateValue = extractCookie(authRes.headers, 'foundry_oauth_state');
    expect(stateValue).toBeDefined();

    // Step 2: Simulate GitHub callback (S2 route — already tested elsewhere)
    // We directly fabricate a session cookie as S2 would set it.
    const flowUser = usersDao.upsert({ github_login: 'flow-test-user', github_id: 87654 });
    const sessionValue = makeSessionCookie(flowUser.id);

    // Step 3: POST /oauth/consent — user approves
    const consentRes = await request(app)
      .post('/oauth/consent')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(sessionValue)}`,
        `foundry_oauth_pending=${encodeURIComponent(pendingValue!)}`,
      ].join('; '))
      .send('action=approve')
      .expect(302);

    const location = consentRes.headers.location as string;
    expect(location).toContain(REDIRECT_URI);
    const url = new URL(location);
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('flow-test-state');
  });
});
