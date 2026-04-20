/**
 * Tests for FND-E12-S6: POST /oauth/token
 *
 * Grants:
 *   - authorization_code (exchange a minted code for access + refresh tokens)
 *   - refresh_token (rotate: revoke old, mint new)
 *
 * Strategy:
 *   - Real SQLite DB (temp file) via FOUNDRY_DB_PATH.
 *   - Real DAOs (clientsDao, codesDao, tokensDao, usersDao) — no stubs.
 *   - No outbound HTTP, so no fetch mocking needed.
 *
 * PKCE test vector (RFC 7636):
 *   verifier:  dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
 *   challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
 */

// ─── Env must be set before any module import ─────────────────────────────
process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.test';
process.env.FOUNDRY_OAUTH_SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';
process.env.GITHUB_OAUTH_CLIENT_ID = 'test-gh-client-id';
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-gh-client-secret';
process.env.FOUNDRY_PRIVATE_DOC_USERS = '';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import crypto from 'crypto';

import { createOauthTokenRouter } from '../oauth-token.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, codesDao, tokensDao, usersDao } from '../../oauth/dao.js';

// ─── DB setup ─────────────────────────────────────────────────────────────

const testDbPath = join(
  tmpdir(),
  `foundry-oauth-token-test-${process.pid}-${Date.now()}.db`
);

let app: express.Express;

// ─── Canonical PKCE test vector ───────────────────────────────────────────

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT_URI = 'https://claude.ai/oauth/callback';

// ─── Shared client registrations ──────────────────────────────────────────

let clientId: string;
let clientSecret: string;

// A second client for cross-client-attempt tests
let otherClientId: string;
let otherClientSecret: string;

// ─── Test user ────────────────────────────────────────────────────────────

let userId: string;

// ─── Helpers ──────────────────────────────────────────────────────────────

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Mint a fresh auth code for the happy-path user and return its plaintext.
 */
function mintCode(opts: {
  scope?: string;
  redirectUri?: string;
  pkceChallenge?: string;
  clientIdOverride?: string;
} = {}): string {
  const { code } = codesDao.mint({
    client_id: opts.clientIdOverride ?? clientId,
    user_id: userId,
    scope: opts.scope ?? 'docs:read docs:write',
    redirect_uri: opts.redirectUri ?? REDIRECT_URI,
    pkce_challenge: opts.pkceChallenge ?? CHALLENGE,
  });
  return code;
}

/**
 * Form-encode an object as x-www-form-urlencoded.
 */
function form(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

/**
 * Build a full valid authorization_code body.
 */
function validCodeBody(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    grant_type: 'authorization_code',
    code: '__set_by_caller__',
    code_verifier: VERIFIER,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    ...overrides,
  };
}

/**
 * Build a full valid refresh_token body.
 */
function validRefreshBody(refreshToken: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    ...overrides,
  };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  closeDb();
  getDb(); // creates schema

  app = express();
  app.use('/', createOauthTokenRouter());

  // Global error handler (mirror other test suites)
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(err.status ?? 500).json({ error: err.message ?? 'internal error' });
    }
  );

  // Register two clients
  const a = clientsDao.register({
    name: 'Claude.ai Connector',
    redirect_uris: REDIRECT_URI,
    client_type: 'autonomous',
  });
  clientId = a.id;
  clientSecret = a.secret;

  const b = clientsDao.register({
    name: 'Other Client',
    redirect_uris: REDIRECT_URI,
    client_type: 'autonomous',
  });
  otherClientId = b.id;
  otherClientSecret = b.secret;

  // Create the test user
  const u = usersDao.upsert({ github_login: 'token-test-user', github_id: 424242 });
  userId = u.id;
});

afterAll(() => {
  closeDb();
  try {
    unlinkSync(testDbPath);
  } catch {
    /* ignore */
  }
  delete process.env.FOUNDRY_DB_PATH;
});

// ═══════════════════════════════════════════════════════════════════════════
// Top-level request shape
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /oauth/token — request shape', () => {
  it('returns 400 invalid_request when grant_type is missing', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('client_id=whatever')
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/grant_type/);
  });

  it('returns 400 unsupported_grant_type for unknown grants (e.g., client_credentials)', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form({ grant_type: 'client_credentials', client_id: 'x', client_secret: 'y' }))
      .expect(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('returns 400 unsupported_grant_type for the password grant', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(
        form({
          grant_type: 'password',
          username: 'u',
          password: 'p',
          client_id: 'x',
          client_secret: 'y',
        })
      )
      .expect(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('tolerates an empty body (returns invalid_request)', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('')
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('sets Cache-Control: no-store on error responses', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('')
      .expect(400);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Grant: authorization_code
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /oauth/token — authorization_code happy path (AC1)', () => {
  it('exchanges a code for access + refresh tokens', async () => {
    const code = mintCode();
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code })))
      .expect(200);

    expect(res.body.access_token).toEqual(expect.any(String));
    expect(res.body.access_token.length).toBeGreaterThan(0);
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.refresh_token).toEqual(expect.any(String));
    expect(res.body.refresh_token.length).toBeGreaterThan(0);
    expect(res.body.scope).toBe('docs:read docs:write');
  });

  it('persists the minted tokens as sha256 hashes (not plaintext)', async () => {
    const code = mintCode();
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code })))
      .expect(200);

    const db = getDb();
    const row = db
      .prepare('SELECT * FROM oauth_tokens WHERE access_token_hash = ?')
      .get(sha256Hex(res.body.access_token)) as any;
    expect(row).toBeDefined();
    expect(row.client_id).toBe(clientId);
    expect(row.user_id).toBe(userId);
    expect(row.scope).toBe('docs:read docs:write');
    expect(row.revoked_at).toBeNull();
  });

  it('the minted access_token passes tokensDao.introspect', async () => {
    const code = mintCode();
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code })))
      .expect(200);

    const info = tokensDao.introspect(res.body.access_token);
    expect(info).not.toBeNull();
    expect(info!.user_id).toBe(userId);
    expect(info!.client_id).toBe(clientId);
  });
});

describe('POST /oauth/token — authorization_code errors', () => {
  it('returns 400 invalid_request when required params are missing', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form({ grant_type: 'authorization_code', code: 'x' }))
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('AC4 — returns 401 invalid_client for wrong client_secret', async () => {
    const code = mintCode();
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code, client_secret: 'definitely-wrong-secret' })))
      .expect(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('returns 401 invalid_client for unknown client_id', async () => {
    const code = mintCode();
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code, client_id: 'not-a-real-client' })))
      .expect(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('AC3 — returns 400 invalid_grant when code has already been consumed', async () => {
    const code = mintCode();

    // First exchange succeeds
    await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code })))
      .expect(200);

    // Second exchange with same code must fail as invalid_grant
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code })))
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('returns 400 invalid_grant for an unknown code', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code: 'definitely-not-a-real-code' })))
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('AC2 — returns 400 invalid_grant for PKCE mismatch', async () => {
    const code = mintCode();
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(
        form(
          validCodeBody({
            code,
            code_verifier: 'this-verifier-does-not-match-the-challenge',
          })
        )
      )
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('returns 400 invalid_grant when redirect_uri does not match', async () => {
    const code = mintCode();
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(
        form(validCodeBody({ code, redirect_uri: 'https://evil.example.com/cb' }))
      )
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('returns 400 invalid_grant when a code is redeemed by a different client', async () => {
    // Mint the code for clientId (happy path)
    const code = mintCode();

    // Attacker has a legit (otherClientId, otherClientSecret) — try to redeem
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(
        form(
          validCodeBody({
            code,
            client_id: otherClientId,
            client_secret: otherClientSecret,
          })
        )
      )
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('narrows scope via intersection when user has lost private access since mint', async () => {
    // Mint a code that includes docs:read:private
    const code = mintCode({ scope: 'docs:read docs:read:private' });

    // At token-exchange time, the user is NOT in FOUNDRY_PRIVATE_DOC_USERS,
    // so resolveScopes returns ['docs:read', 'docs:write']. Intersection
    // with the code's scope drops docs:read:private.
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validCodeBody({ code })))
      .expect(200);

    expect(res.body.scope).toBe('docs:read');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Grant: refresh_token
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper: run an authorization_code exchange to the end and return the
 * resulting access+refresh pair. Used to set up refresh-grant tests.
 */
async function getTokenPair(): Promise<{
  access_token: string;
  refresh_token: string;
}> {
  const code = mintCode();
  const res = await request(app)
    .post('/oauth/token')
    .set('Content-Type', 'application/x-www-form-urlencoded')
    .send(form(validCodeBody({ code })))
    .expect(200);
  return {
    access_token: res.body.access_token,
    refresh_token: res.body.refresh_token,
  };
}

describe('POST /oauth/token — refresh_token happy path (AC5)', () => {
  it('returns a NEW access token AND a NEW refresh token', async () => {
    const original = await getTokenPair();

    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(original.refresh_token)))
      .expect(200);

    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.access_token).not.toBe(original.access_token);
    expect(res.body.refresh_token).not.toBe(original.refresh_token);
    expect(res.body.scope).toBe('docs:read docs:write');
  });

  it('the old refresh token is marked revoked after rotation', async () => {
    const original = await getTokenPair();

    await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(original.refresh_token)))
      .expect(200);

    const db = getDb();
    const old = db
      .prepare('SELECT revoked_at FROM oauth_tokens WHERE refresh_token_hash = ?')
      .get(sha256Hex(original.refresh_token)) as any;
    expect(old).toBeDefined();
    expect(old.revoked_at).not.toBeNull();
  });

  it('the new access_token introspects successfully', async () => {
    const original = await getTokenPair();

    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(original.refresh_token)))
      .expect(200);

    const info = tokensDao.introspect(res.body.access_token);
    expect(info).not.toBeNull();
    expect(info!.user_id).toBe(userId);
    expect(info!.client_id).toBe(clientId);
  });
});

describe('POST /oauth/token — refresh_token errors', () => {
  it('returns 400 invalid_request when refresh_token is missing', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret }))
      .expect(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('returns 401 invalid_client for wrong client_secret on refresh', async () => {
    const original = await getTokenPair();
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(original.refresh_token, { client_secret: 'nope' })))
      .expect(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('returns 400 invalid_grant for an unknown refresh token', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody('not-a-real-refresh-token')))
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('AC6 — rotation reuse detection: second use of same refresh_token fails', async () => {
    const original = await getTokenPair();

    // First rotation succeeds
    const first = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(original.refresh_token)))
      .expect(200);
    expect(first.body.refresh_token).toBeTruthy();

    // Second use of the ORIGINAL (now-revoked) refresh token must fail
    const reuse = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(original.refresh_token)))
      .expect(400);
    expect(reuse.body.error).toBe('invalid_grant');
  });

  it('AC7 — expired refresh token returns invalid_grant', async () => {
    const original = await getTokenPair();

    // Manually expire the refresh token in the DB
    const db = getDb();
    db.prepare(
      'UPDATE oauth_tokens SET refresh_expires_at = ? WHERE refresh_token_hash = ?'
    ).run('2000-01-01T00:00:00.000Z', sha256Hex(original.refresh_token));

    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(original.refresh_token)))
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
    expect(res.body.error_description).toMatch(/expired/i);
  });

  it('returns 400 invalid_grant when another client presents a valid refresh_token', async () => {
    // Tokens minted for clientId…
    const original = await getTokenPair();

    // …presented by otherClient (authenticated correctly) must fail.
    const res = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(
        form(
          validRefreshBody(original.refresh_token, {
            client_id: otherClientId,
            client_secret: otherClientSecret,
          })
        )
      )
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
    // The refresh token should NOT have been revoked by the failed attempt,
    // since the client_id check precedes the revoke inside the transaction.
    const db = getDb();
    const row = db
      .prepare('SELECT revoked_at FROM oauth_tokens WHERE refresh_token_hash = ?')
      .get(sha256Hex(original.refresh_token)) as any;
    expect(row.revoked_at).toBeNull();
  });

  it('new refresh_token from rotation can itself be rotated (chain continues)', async () => {
    const original = await getTokenPair();

    const r1 = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(original.refresh_token)))
      .expect(200);

    const r2 = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form(validRefreshBody(r1.body.refresh_token)))
      .expect(200);

    expect(r2.body.access_token).not.toBe(r1.body.access_token);
    expect(r2.body.refresh_token).not.toBe(r1.body.refresh_token);
  });
});
