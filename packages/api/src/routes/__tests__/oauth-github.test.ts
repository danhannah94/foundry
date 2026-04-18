import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';

// ─── Setup: env vars ──────────────────────────────────────────────────────────
// Must be set before importing anything that reads them at module load.
process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.example.com';
process.env.FOUNDRY_OAUTH_SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';
process.env.GITHUB_OAUTH_CLIENT_ID = 'test-gh-client-id';
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-gh-client-secret';
process.env.FOUNDRY_PRIVATE_DOC_USERS = 'privileged-user,another-admin';

// ─── Import modules under test ─────────────────────────────────────────────
import { createOauthGithubRouter } from '../oauth-github.js';
import { signCookie, verifyCookie } from '../../oauth/session.js';
import { buildAuthorizeUrl, resolveScopes } from '../../oauth/github.js';
import { getDb, closeDb } from '../../db.js';

// ─── Test DB setup ─────────────────────────────────────────────────────────
const testDbPath = join(tmpdir(), `foundry-test-oauth-github-${Date.now()}.db`);
let app: express.Express;

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;

  app = express();
  app.use(express.json());
  app.use('/', createOauthGithubRouter());
});

afterAll(() => {
  closeDb();
  try {
    unlinkSync(testDbPath);
  } catch {
    // ignore
  }
});

// ─── Helper: build a valid signed state cookie ────────────────────────────
function makeStateCookie(state: string, ttlSeconds = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return signCookie({ state, exp });
}

// ─── Helper: mock fetch ───────────────────────────────────────────────────
function mockFetch(responses: Array<{ ok: boolean; status?: number; json?: object }>) {
  let callIndex = 0;
  return vi.spyOn(global, 'fetch').mockImplementation(async () => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1];
    return {
      ok: resp.ok,
      status: resp.status ?? (resp.ok ? 200 : 500),
      statusText: resp.ok ? 'OK' : 'Error',
      json: async () => resp.json ?? {},
    } as Response;
  });
}

// ─── signCookie / verifyCookie unit tests ─────────────────────────────────

describe('signCookie / verifyCookie', () => {
  it('round-trips a payload', () => {
    const payload = { state: 'abc123', exp: Math.floor(Date.now() / 1000) + 300 };
    const raw = signCookie(payload);
    const result = verifyCookie(raw);
    expect(result).not.toBeNull();
    expect(result!.state).toBe('abc123');
  });

  it('returns null when HMAC is tampered', () => {
    const payload = { state: 'abc123', exp: Math.floor(Date.now() / 1000) + 300 };
    const raw = signCookie(payload);
    // Tamper: flip last char of HMAC part
    const tampered = raw.slice(0, -1) + (raw.endsWith('a') ? 'b' : 'a');
    expect(verifyCookie(tampered)).toBeNull();
  });

  it('returns null when payload has been modified', () => {
    const payload = { state: 'abc123', exp: Math.floor(Date.now() / 1000) + 300 };
    const raw = signCookie(payload);
    const [_payloadPart, hmacPart] = raw.split('.');
    // Swap in a different payload but keep the same HMAC
    const fakePayload = Buffer.from(JSON.stringify({ state: 'hacked', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
    const forged = `${fakePayload}.${hmacPart}`;
    expect(verifyCookie(forged)).toBeNull();
  });

  it('returns null when cookie is expired', () => {
    const payload = { state: 'abc123', exp: Math.floor(Date.now() / 1000) - 1 };
    const raw = signCookie(payload);
    expect(verifyCookie(raw)).toBeNull();
  });

  it('returns null for malformed cookie (no dot separator)', () => {
    expect(verifyCookie('notacookieatall')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(verifyCookie('')).toBeNull();
  });
});

// ─── buildAuthorizeUrl unit tests ─────────────────────────────────────────

describe('buildAuthorizeUrl', () => {
  it('includes client_id, scope, state, and redirect_uri', () => {
    const url = buildAuthorizeUrl('test-state-value');
    expect(url).toContain('https://github.com/login/oauth/authorize');
    expect(url).toContain('client_id=test-gh-client-id');
    expect(url).toContain('scope=read%3Auser');
    expect(url).toContain('state=test-state-value');
    expect(url).toContain('redirect_uri=https%3A%2F%2Ffoundry.example.com%2Foauth%2Fgithub%2Fcallback');
  });

  it('throws if FOUNDRY_OAUTH_ISSUER is unset', () => {
    const orig = process.env.FOUNDRY_OAUTH_ISSUER;
    delete process.env.FOUNDRY_OAUTH_ISSUER;
    expect(() => buildAuthorizeUrl('s')).toThrow('FOUNDRY_OAUTH_ISSUER');
    process.env.FOUNDRY_OAUTH_ISSUER = orig;
  });
});

// ─── resolveScopes unit tests ─────────────────────────────────────────────

describe('resolveScopes', () => {
  it('returns private scope for allowlisted user', () => {
    const scopes = resolveScopes('privileged-user');
    expect(scopes).toContain('docs:read:private');
    expect(scopes).toContain('docs:read');
    expect(scopes).toContain('docs:write');
  });

  it('does not return private scope for non-allowlisted user', () => {
    const scopes = resolveScopes('regular-user');
    expect(scopes).not.toContain('docs:read:private');
    expect(scopes).toContain('docs:read');
    expect(scopes).toContain('docs:write');
  });

  it('handles empty FOUNDRY_PRIVATE_DOC_USERS gracefully', () => {
    const orig = process.env.FOUNDRY_PRIVATE_DOC_USERS;
    process.env.FOUNDRY_PRIVATE_DOC_USERS = '';
    expect(resolveScopes('anyone')).not.toContain('docs:read:private');
    process.env.FOUNDRY_PRIVATE_DOC_USERS = orig;
  });
});

// ─── GET /oauth/github/callback integration tests ────────────────────────

describe('GET /oauth/github/callback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Missing params ─────────────────────────────────────────────────────

  it('returns 400 when code is missing', async () => {
    const res = await request(app)
      .get('/oauth/github/callback?state=some-state')
      .expect(400);
    expect(res.body.error).toMatch(/code/i);
  });

  it('returns 400 when state is missing', async () => {
    const res = await request(app)
      .get('/oauth/github/callback?code=some-code')
      .expect(400);
    expect(res.body.error).toMatch(/state/i);
  });

  it('returns 400 when both code and state are missing', async () => {
    await request(app)
      .get('/oauth/github/callback')
      .expect(400);
  });

  // ── State cookie validation ─────────────────────────────────────────────

  it('returns 400 when state cookie is absent', async () => {
    const res = await request(app)
      .get('/oauth/github/callback?code=abc&state=xyz')
      .expect(400);
    expect(res.body.error).toMatch(/state cookie/i);
  });

  it('returns 400 when state cookie has been tampered (HMAC check)', async () => {
    const rawCookie = makeStateCookie('good-state');
    const tampered = rawCookie.slice(0, -1) + (rawCookie.endsWith('a') ? 'b' : 'a');
    const res = await request(app)
      .get('/oauth/github/callback?code=abc&state=good-state')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(tampered)}`)
      .expect(400);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it('returns 400 when state cookie is expired', async () => {
    const rawCookie = makeStateCookie('my-state', -1); // already expired
    const res = await request(app)
      .get('/oauth/github/callback?code=abc&state=my-state')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(400);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it('returns 400 when state in query does not match cookie state', async () => {
    const rawCookie = makeStateCookie('correct-state');
    const res = await request(app)
      .get('/oauth/github/callback?code=abc&state=wrong-state')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(400);
    expect(res.body.error).toMatch(/mismatch/i);
  });

  // ── GitHub API errors ──────────────────────────────────────────────────

  it('returns 502 when GitHub token exchange returns non-200', async () => {
    mockFetch([{ ok: false, status: 400, json: { error: 'bad_verification_code' } }]);
    const rawCookie = makeStateCookie('state-abc');
    const res = await request(app)
      .get('/oauth/github/callback?code=bad-code&state=state-abc')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(502);
    expect(res.body.error).toMatch(/token exchange/i);
  });

  it('returns 502 when GitHub token exchange returns no access_token', async () => {
    mockFetch([{ ok: true, json: { error: 'incorrect_client_credentials' } }]);
    const rawCookie = makeStateCookie('state-def');
    const res = await request(app)
      .get('/oauth/github/callback?code=bad-creds&state=state-def')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(502);
    expect(res.body.error).toMatch(/token exchange/i);
  });

  it('returns 502 when GitHub user fetch returns non-200', async () => {
    mockFetch([
      { ok: true, json: { access_token: 'gho_test' } },
      { ok: false, status: 401, json: { message: 'Bad credentials' } },
    ]);
    const rawCookie = makeStateCookie('state-ghi');
    const res = await request(app)
      .get('/oauth/github/callback?code=validcode&state=state-ghi')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(502);
    expect(res.body.error).toMatch(/user fetch/i);
  });

  // ── Successful flow: non-allowlisted user ──────────────────────────────

  it('redirects to /oauth/consent and sets session cookie for a regular user', async () => {
    mockFetch([
      { ok: true, json: { access_token: 'gho_regular_token' } },
      { ok: true, json: { login: 'regular-user', id: 99001 } },
    ]);
    const rawCookie = makeStateCookie('state-regular');
    const res = await request(app)
      .get('/oauth/github/callback?code=validcode&state=state-regular')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(302);

    expect(res.headers.location).toBe('/oauth/consent');

    // Session cookie should be present
    const setCookieHeader = res.headers['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    const sessionCookieStr = (Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader])
      .find((c: string) => c.startsWith('foundry_oauth_session='));
    expect(sessionCookieStr).toBeDefined();

    // Parse and verify the session cookie payload
    const match = sessionCookieStr!.match(/foundry_oauth_session=([^;]+)/);
    expect(match).not.toBeNull();
    const sessionPayload = verifyCookie(decodeURIComponent(match![1]));
    expect(sessionPayload).not.toBeNull();
    expect(sessionPayload!.scopes).toContain('docs:read');
    expect(sessionPayload!.scopes).toContain('docs:write');
    expect((sessionPayload!.scopes as string[])).not.toContain('docs:read:private');
    expect(typeof sessionPayload!.user_id).toBe('string');
  });

  // ── Successful flow: allowlisted user ─────────────────────────────────

  it('redirects to /oauth/consent and sets session cookie with private scope for allowlisted user', async () => {
    mockFetch([
      { ok: true, json: { access_token: 'gho_privileged_token' } },
      { ok: true, json: { login: 'privileged-user', id: 99002 } },
    ]);
    const rawCookie = makeStateCookie('state-privileged');
    const res = await request(app)
      .get('/oauth/github/callback?code=validcode&state=state-privileged')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(302);

    expect(res.headers.location).toBe('/oauth/consent');

    const setCookieHeader = res.headers['set-cookie'];
    const sessionCookieStr = (Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader])
      .find((c: string) => c.startsWith('foundry_oauth_session='));
    expect(sessionCookieStr).toBeDefined();

    // Session should include docs:read:private
    const match = sessionCookieStr!.match(/foundry_oauth_session=([^;]+)/);
    const sessionPayload = verifyCookie(decodeURIComponent(match![1]));
    expect(sessionPayload).not.toBeNull();
    expect((sessionPayload!.scopes as string[])).toContain('docs:read:private');
    expect((sessionPayload!.scopes as string[])).toContain('docs:read');
    expect((sessionPayload!.scopes as string[])).toContain('docs:write');
  });

  // ── usersDao.upsert is called ──────────────────────────────────────────

  it('upserts the user into the database', async () => {
    mockFetch([
      { ok: true, json: { access_token: 'gho_upsert_test' } },
      { ok: true, json: { login: 'upsert-test-user', id: 77777 } },
    ]);
    const rawCookie = makeStateCookie('state-upsert');
    await request(app)
      .get('/oauth/github/callback?code=validcode&state=state-upsert')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(302);

    // Verify the user was written to the DB
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE github_id = ?').get(77777) as any;
    expect(user).toBeDefined();
    expect(user.github_login).toBe('upsert-test-user');
    expect(user.github_id).toBe(77777);
  });

  it('upserts an existing user (updates github_login)', async () => {
    // First call — create user
    mockFetch([
      { ok: true, json: { access_token: 'gho_update_test1' } },
      { ok: true, json: { login: 'original-login', id: 88888 } },
    ]);
    const cookie1 = makeStateCookie('state-upd1');
    await request(app)
      .get('/oauth/github/callback?code=validcode&state=state-upd1')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(cookie1)}`)
      .expect(302);

    vi.restoreAllMocks();

    // Second call — same github_id, new login (rename scenario)
    mockFetch([
      { ok: true, json: { access_token: 'gho_update_test2' } },
      { ok: true, json: { login: 'renamed-login', id: 88888 } },
    ]);
    const cookie2 = makeStateCookie('state-upd2');
    await request(app)
      .get('/oauth/github/callback?code=validcode&state=state-upd2')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(cookie2)}`)
      .expect(302);

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE github_id = ?').get(88888) as any;
    expect(user.github_login).toBe('renamed-login');
  });

  // ── Cookie attributes ──────────────────────────────────────────────────

  it('sets HttpOnly, SameSite=Lax, Path=/ on the session cookie', async () => {
    mockFetch([
      { ok: true, json: { access_token: 'gho_attr_test' } },
      { ok: true, json: { login: 'attr-user', id: 99999 } },
    ]);
    const rawCookie = makeStateCookie('state-attr');
    const res = await request(app)
      .get('/oauth/github/callback?code=validcode&state=state-attr')
      .set('Cookie', `foundry_oauth_state=${encodeURIComponent(rawCookie)}`)
      .expect(302);

    const setCookieHeader = res.headers['set-cookie'];
    const sessionCookieStr = (Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader])
      .find((c: string) => c.startsWith('foundry_oauth_session='));
    expect(sessionCookieStr).toBeDefined();
    expect(sessionCookieStr).toContain('HttpOnly');
    expect(sessionCookieStr).toContain('SameSite=Lax');
    expect(sessionCookieStr).toContain('Path=/');
  });
});
