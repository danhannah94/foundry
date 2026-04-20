/**
 * FND-E12-S12 — end-to-end OAuth flow test.
 *
 * Walks a complete auth exchange against the real route handlers and real
 * DAOs on an in-memory-equivalent temp SQLite DB:
 *
 *   DCR → authorize → consent → token exchange → authenticated MCP call →
 *   refresh with rotation → rotation reuse detection
 *
 * This is the integration layer between the per-endpoint unit tests in
 * src/routes/__tests__ and the external conformance test in
 * scripts/oauth-conformance.mjs. If a wiring regression breaks the joint
 * behavior without breaking any individual endpoint's contract, this file
 * is where it gets caught.
 *
 * Additionally covers security acceptance criteria from the S12 checklist
 * that don't fit any single endpoint's test file:
 *   - AC2: `state` echoed back verbatim in the authorize redirect
 *   - AC3: redirect_uri is an exact string match (query-param strip rejected)
 *   - AC6: token material never appears in log output
 *   - AC9: Host header cannot override FOUNDRY_OAUTH_ISSUER
 */

// ─── Env must be set before any module import ─────────────────────────────
process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.test';
process.env.FOUNDRY_OAUTH_SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';
process.env.GITHUB_OAUTH_CLIENT_ID = 'test-gh-client-id';
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-gh-client-secret';
process.env.FOUNDRY_PRIVATE_DOC_USERS = '';
process.env.FOUNDRY_DCR_TOKEN = 'e2e-dcr-token-48-chars-long-xxxxxxxxxxxxxxxxxx';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import crypto from 'crypto';

import { createOauthRouter } from '../src/routes/oauth.js';
import { createOauthRegisterRouter } from '../src/routes/oauth-register.js';
import { createOauthTokenRouter } from '../src/routes/oauth-token.js';
import { createOauthDiscoveryRouter } from '../src/routes/oauth-discovery.js';
import { requireAuth } from '../src/middleware/auth.js';
import { signCookie } from '../src/oauth/session.js';
import { closeDb, getDb } from '../src/db.js';
import { usersDao } from '../src/oauth/dao.js';

// ─── Canonical PKCE test vector (RFC 7636) ─────────────────────────────────
const PKCE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const DCR_TOKEN = process.env.FOUNDRY_DCR_TOKEN!;
const REDIRECT_URI = 'https://claude.ai/oauth/callback';

const testDbPath = join(
  tmpdir(),
  `foundry-oauth-e2e-${process.pid}-${Date.now()}.db`
);

let app: express.Express;
let userId: string;

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  closeDb();
  getDb();

  // Seed a real user as if GitHub OAuth had already completed for them.
  // The E2E test crafts a signed session cookie referencing this user so
  // we can drive /oauth/authorize as a logged-in caller without actually
  // hitting GitHub.
  const user = usersDao.upsert({ github_login: 'e2e-user', github_id: 424242 });
  userId = user.id;

  app = express();
  app.use(express.json());
  app.use('/', createOauthDiscoveryRouter());
  app.use('/', createOauthRegisterRouter());
  app.use('/', createOauthRouter());
  app.use('/', createOauthTokenRouter());

  // Stand in for the real /mcp mount in src/index.ts. We don't need the
  // MCP JSON-RPC server for an auth-plumbing test — we just need to prove
  // that a token minted through the full flow is accepted by requireAuth
  // and that req.user / req.client are populated downstream of it. If
  // anything about the minting flow (scopes, user_id, client_id binding)
  // is broken, this handler surfaces it.
  app.post('/mcp', requireAuth, (req, res) => {
    res.json({
      ok: true,
      user_id: req.user?.id,
      client_id: req.client?.id,
      scopes: req.user?.scopes,
      client_type: req.client?.client_type,
    });
  });
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

// ─── Helpers ───────────────────────────────────────────────────────────────

function form(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

function makeSessionCookie(uid: string, scopes: string[] = ['docs:read', 'docs:write']): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return signCookie({ user_id: uid, scopes, exp });
}

function getSetCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  const list: string[] = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  const entry = list.find(c => c.startsWith(`${name}=`));
  if (!entry) return undefined;
  return decodeURIComponent(entry.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? '');
}

// ═══════════════════════════════════════════════════════════════════════════
// Full-flow walk
// ═══════════════════════════════════════════════════════════════════════════

describe('OAuth E2E — full flow walk (S12)', () => {
  it('DCR → authorize → consent → token → MCP call → refresh → reuse detection', async () => {
    const clientState = 'e2e-client-state-value';

    // ── 1. Dynamic Client Registration ──────────────────────────────────
    const dcr = await request(app)
      .post('/oauth/register')
      .set('Authorization', `Bearer ${DCR_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'E2E Test Client',
        redirect_uris: [REDIRECT_URI],
        client_type: 'autonomous',
      })
      .expect(201);

    expect(dcr.body.client_id).toBeTruthy();
    expect(dcr.body.client_secret).toBeTruthy();
    const { client_id, client_secret } = dcr.body;

    // ── 2. Authorize (user already "logged in" via crafted session cookie)
    const sessionCookie = makeSessionCookie(userId);
    const authorize = await request(app)
      .get('/oauth/authorize')
      .set('Cookie', `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`)
      .query({
        client_id,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'docs:read docs:write',
        state: clientState,
        code_challenge: PKCE_CHALLENGE,
        code_challenge_method: 'S256',
      })
      .expect(200);

    // Body is the consent HTML. Pending cookie is what matters for step 3.
    expect(authorize.text).toMatch(/consent|approve/i);
    const pendingCookie = getSetCookie(authorize, 'foundry_oauth_pending');
    expect(pendingCookie).toBeTruthy();

    // ── 3. Consent approve → redirect with code + state ─────────────────
    const consent = await request(app)
      .post('/oauth/consent')
      .set(
        'Cookie',
        `foundry_oauth_session=${encodeURIComponent(sessionCookie)}; foundry_oauth_pending=${encodeURIComponent(pendingCookie!)}`
      )
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('action=approve')
      .expect(302);

    const location = consent.headers.location as string;
    expect(location.startsWith(REDIRECT_URI)).toBe(true);

    const locationUrl = new URL(location);
    const code = locationUrl.searchParams.get('code');
    const echoedState = locationUrl.searchParams.get('state');
    expect(code).toBeTruthy();
    // AC2: state must be echoed back verbatim
    expect(echoedState).toBe(clientState);

    // ── 4. Token exchange ───────────────────────────────────────────────
    const tokenExchange = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(
        form({
          grant_type: 'authorization_code',
          code: code!,
          code_verifier: PKCE_VERIFIER,
          client_id,
          client_secret,
          redirect_uri: REDIRECT_URI,
        })
      )
      .expect(200);

    expect(tokenExchange.body.access_token).toBeTruthy();
    expect(tokenExchange.body.refresh_token).toBeTruthy();
    expect(tokenExchange.body.token_type).toBe('Bearer');
    const { access_token, refresh_token } = tokenExchange.body;

    // ── 5. Authenticated MCP call — requireAuth accepts the minted token
    //       and populates req.user / req.client end-to-end. ──────────────
    const mcpCall = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${access_token}`)
      .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
      .expect(200);

    expect(mcpCall.body.ok).toBe(true);
    expect(mcpCall.body.user_id).toBe(userId);
    expect(mcpCall.body.client_id).toBe(client_id);
    expect(mcpCall.body.client_type).toBe('autonomous');
    expect(mcpCall.body.scopes).toEqual(
      expect.arrayContaining(['docs:read', 'docs:write'])
    );

    // ── 6. Refresh rotation — old refresh token revoked, new pair issued
    const firstRefresh = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form({ grant_type: 'refresh_token', refresh_token, client_id, client_secret }))
      .expect(200);

    expect(firstRefresh.body.access_token).toBeTruthy();
    expect(firstRefresh.body.refresh_token).toBeTruthy();
    expect(firstRefresh.body.access_token).not.toBe(access_token);
    expect(firstRefresh.body.refresh_token).not.toBe(refresh_token);

    // ── 7. Rotation reuse detection — replaying the original refresh
    //       token now fails because it was revoked in step 6. ────────────
    const reuse = await request(app)
      .post('/oauth/token')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(form({ grant_type: 'refresh_token', refresh_token, client_id, client_secret }))
      .expect(400);

    expect(reuse.body.error).toBe('invalid_grant');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Security acceptance criteria from S12 — gaps not covered per-endpoint
// ═══════════════════════════════════════════════════════════════════════════

describe('OAuth security AC — S12 checklist', () => {
  // ── AC3: redirect_uri is an EXACT string match ──────────────────────────
  //
  // A registered URI of "https://claude.ai/oauth/callback" must not accept
  // "https://claude.ai/oauth/callback?extra=1" in /oauth/authorize. If a
  // future bug introduces query-param stripping or prefix matching, an
  // attacker could register a benign callback and then trick the AS into
  // minting codes against `?token_steal=…` variants.
  it('AC3 — redirect_uri exact match: variant with extra query param is rejected', async () => {
    // Register fresh client for this test
    const dcr = await request(app)
      .post('/oauth/register')
      .set('Authorization', `Bearer ${DCR_TOKEN}`)
      .set('Content-Type', 'application/json')
      .send({
        client_name: 'AC3 Client',
        redirect_uris: [REDIRECT_URI],
        client_type: 'autonomous',
      })
      .expect(201);

    const res = await request(app)
      .get('/oauth/authorize')
      .query({
        client_id: dcr.body.client_id,
        redirect_uri: `${REDIRECT_URI}?token_steal=1`,
        response_type: 'code',
        scope: 'docs:read',
        state: 'ac3-state',
        code_challenge: PKCE_CHALLENGE,
        code_challenge_method: 'S256',
      })
      .expect(400);

    expect(res.body.error).toBe('invalid_request');
    expect(res.body.error_description).toMatch(/redirect_uri/);
  });

  // ── AC6: no token material in logs ──────────────────────────────────────
  //
  // Walks a minimal token mint and intercepts console output across the
  // whole flow. Access, refresh, and authorization codes must never appear
  // in plaintext — even at debug level. Catches accidental `console.log(req.body)`
  // regressions that would otherwise only surface during a log review.
  it('AC6 — access/refresh/auth-code never appear in log output', async () => {
    const logs: string[] = [];
    const capture = (...args: unknown[]): void => {
      logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(capture),
      vi.spyOn(console, 'info').mockImplementation(capture),
      vi.spyOn(console, 'warn').mockImplementation(capture),
      vi.spyOn(console, 'debug').mockImplementation(capture),
      vi.spyOn(console, 'error').mockImplementation(capture),
    ];

    try {
      const dcr = await request(app)
        .post('/oauth/register')
        .set('Authorization', `Bearer ${DCR_TOKEN}`)
        .set('Content-Type', 'application/json')
        .send({
          client_name: 'AC6 Client',
          redirect_uris: [REDIRECT_URI],
          client_type: 'autonomous',
        })
        .expect(201);

      const sessionCookie = makeSessionCookie(userId);
      const authorize = await request(app)
        .get('/oauth/authorize')
        .set('Cookie', `foundry_oauth_session=${encodeURIComponent(sessionCookie)}`)
        .query({
          client_id: dcr.body.client_id,
          redirect_uri: REDIRECT_URI,
          response_type: 'code',
          scope: 'docs:read',
          state: 'ac6-state',
          code_challenge: PKCE_CHALLENGE,
          code_challenge_method: 'S256',
        })
        .expect(200);

      const pending = getSetCookie(authorize, 'foundry_oauth_pending');
      const consent = await request(app)
        .post('/oauth/consent')
        .set(
          'Cookie',
          `foundry_oauth_session=${encodeURIComponent(sessionCookie)}; foundry_oauth_pending=${encodeURIComponent(pending!)}`
        )
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('action=approve')
        .expect(302);

      const code = new URL(consent.headers.location as string).searchParams.get('code')!;
      const tokens = await request(app)
        .post('/oauth/token')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(
          form({
            grant_type: 'authorization_code',
            code,
            code_verifier: PKCE_VERIFIER,
            client_id: dcr.body.client_id,
            client_secret: dcr.body.client_secret,
            redirect_uri: REDIRECT_URI,
          })
        )
        .expect(200);

      const haystack = logs.join('\n');
      expect(haystack).not.toContain(code);
      expect(haystack).not.toContain(tokens.body.access_token);
      expect(haystack).not.toContain(tokens.body.refresh_token);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  // ── AC9: Host header cannot override the issuer ─────────────────────────
  //
  // The issuer in discovery metadata and in minted token responses must
  // come from FOUNDRY_OAUTH_ISSUER, never from req.headers.host. A Host-
  // header-derived fallback would let any proxy or malicious caller force
  // the AS to advertise an issuer of their choosing, breaking RFC 8414
  // validation downstream and enabling issuer confusion attacks.
  it('AC9 — discovery issuer is FOUNDRY_OAUTH_ISSUER regardless of Host header', async () => {
    const res = await request(app)
      .get('/.well-known/oauth-authorization-server')
      .set('Host', 'evil.attacker.example')
      .expect(200);

    expect(res.body.issuer).toBe('https://foundry.test');
    // Downstream endpoints share the same base — quick sanity:
    expect(res.body.token_endpoint).toMatch(/^https:\/\/foundry\.test/);
    expect(res.body.authorization_endpoint).toMatch(/^https:\/\/foundry\.test/);
  });
});
