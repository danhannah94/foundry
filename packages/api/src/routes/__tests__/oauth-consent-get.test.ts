/**
 * Tests for FND-E12-S5 hotfix: GET /oauth/consent
 *
 * Regression: the GitHub callback redirects to GET /oauth/consent, but the
 * original PR only registered POST /oauth/consent. Express fell through to
 * Astro which 404'd with ENOENT — the full GitHub login flow landed on a
 * broken page in prod. Unit tests asserted the callback's redirect *target*
 * but never followed it, so the gap shipped.
 *
 * These tests exercise GET /oauth/consent directly AND follow the callback
 * redirect end-to-end so the integration seam is covered.
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
import { createOauthGithubRouter } from '../oauth-github.js';
import { signCookie } from '../../oauth/session.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, usersDao } from '../../oauth/dao.js';

// ─── DB setup ──────────────────────────────────────────────────────────────

const testDbPath = join(tmpdir(), `foundry-oauth-consent-get-test-${process.pid}-${Date.now()}.db`);

let app: express.Express;
let clientId: string;
let userId: string;

const REDIRECT_URI = 'https://claude.ai/oauth/callback';
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

// ─── Cookie helpers ────────────────────────────────────────────────────────

function makeSessionCookie(uid: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return signCookie({ user_id: uid, scopes: ['docs:read'], exp });
}

function makePendingCookie(overrides: Record<string, unknown> = {}, ttlSeconds = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return signCookie({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'docs:read',
    state: 'test-state',
    code_challenge: CODE_CHALLENGE,
    exp,
    ...overrides,
  });
}

function makeStateCookie(state: string, ttlSeconds = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return signCookie({ state, exp });
}

// ─── Mock fetch helper (for callback integration test) ─────────────────────

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

// ─── Bootstrap ─────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  closeDb();
  getDb();

  app = express();
  app.use(express.json());
  app.use('/', createOauthRouter());
  app.use('/', createOauthGithubRouter());
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? 'internal error' });
  });

  const { id } = clientsDao.register({
    name: 'Claude.ai Connector',
    redirect_uris: REDIRECT_URI,
    client_type: 'autonomous',
  });
  clientId = id;

  const user = usersDao.upsert({ github_login: 'consent-get-user', github_id: 99001 });
  userId = user.id;
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
// GET /oauth/consent — direct
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /oauth/consent', () => {
  it('renders consent HTML when session + pending cookies are valid', async () => {
    const res = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(makeSessionCookie(userId))}`,
        `foundry_oauth_pending=${encodeURIComponent(makePendingCookie())}`,
      ])
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Claude.ai Connector');
    expect(res.text).toContain('consent-get-user');
    expect(res.text).toContain('Read public docs');
  });

  it('returns 400 when session cookie missing', async () => {
    const res = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [`foundry_oauth_pending=${encodeURIComponent(makePendingCookie())}`])
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/session or pending/i);
  });

  it('returns 400 when pending cookie missing', async () => {
    const res = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [`foundry_oauth_session=${encodeURIComponent(makeSessionCookie(userId))}`])
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 when session signature is invalid', async () => {
    const res = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [
        'foundry_oauth_session=not.a.valid.signed.cookie',
        `foundry_oauth_pending=${encodeURIComponent(makePendingCookie())}`,
      ])
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 when pending cookie expired', async () => {
    const res = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(makeSessionCookie(userId))}`,
        `foundry_oauth_pending=${encodeURIComponent(makePendingCookie({}, -60))}`,
      ])
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 400 when session references an unknown user', async () => {
    const res = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(makeSessionCookie('nonexistent-user-id'))}`,
        `foundry_oauth_pending=${encodeURIComponent(makePendingCookie())}`,
      ])
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/unknown user/i);
  });

  it('returns 400 when pending references an unknown client', async () => {
    const res = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(makeSessionCookie(userId))}`,
        `foundry_oauth_pending=${encodeURIComponent(makePendingCookie({ client_id: 'nonexistent-client' }))}`,
      ])
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/unknown client/i);
  });

  it('renders multiple scopes with their human labels', async () => {
    const res = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [
        `foundry_oauth_session=${encodeURIComponent(makeSessionCookie(userId))}`,
        `foundry_oauth_pending=${encodeURIComponent(makePendingCookie({ scope: 'docs:read docs:write' }))}`,
      ])
      .expect(200);

    expect(res.text).toContain('Read public docs');
    expect(res.text).toContain('Write annotations');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: GitHub callback → GET /oauth/consent
//
// This is the test that would have caught the original bug. Unit tests asserted
// the callback redirects to /oauth/consent; this test actually follows the
// redirect and asserts the target renders.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration: callback redirects to a working consent page', () => {
  it('callback → /oauth/consent returns 200 HTML (not 404)', async () => {
    const state = 'integration-state';
    mockFetch([
      { ok: true, json: { access_token: 'gh-token' } },
      { ok: true, json: { login: 'integration-user', id: 42 } },
    ]);

    // Step 1: hit the callback as GitHub would
    const callbackRes = await request(app)
      .get('/oauth/github/callback')
      .query({ code: 'gh-code', state })
      .set('Cookie', [
        `foundry_oauth_state=${encodeURIComponent(makeStateCookie(state))}`,
        `foundry_oauth_pending=${encodeURIComponent(makePendingCookie())}`,
      ]);

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toBe('/oauth/consent');

    // Step 2: follow the redirect — this is what the browser does next
    const setCookie = callbackRes.headers['set-cookie'];
    const sessionHeader = (Array.isArray(setCookie) ? setCookie : [setCookie as string])
      .find(c => c?.startsWith('foundry_oauth_session='));
    expect(sessionHeader).toBeDefined();

    const consentRes = await request(app)
      .get('/oauth/consent')
      .set('Cookie', [
        sessionHeader!.split(';')[0],
        `foundry_oauth_pending=${encodeURIComponent(makePendingCookie())}`,
      ]);

    expect(consentRes.status).toBe(200);
    expect(consentRes.headers['content-type']).toMatch(/text\/html/);
    expect(consentRes.text).toContain('Claude.ai Connector');
    expect(consentRes.text).toContain('integration-user');
  });
});
