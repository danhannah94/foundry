/**
 * Tests for FND-E12-S7: dual-auth requireAuth + requireScope middleware.
 *
 * Covers:
 *   - OAuth happy path (valid token → req.user / req.client populated)
 *   - Expired token → 401 with WWW-Authenticate
 *   - Revoked token → 401 with WWW-Authenticate
 *   - Deleted user → 401 invalid_token
 *   - Deleted client → 401 invalid_token
 *   - WWW-Authenticate header shape on no-token 401
 *   - requireScope 403 insufficient_scope
 *   - requireScope 200 when scope granted
 *   - requireScope dev-mode passthrough (no req.user → next())
 *   - Dev-mode passthrough preserved (no env + no header → 200)
 *   - FOUNDRY_OAUTH_ISSUER fail-loud
 *
 * The existing legacy-path tests live in auth.test.ts and must pass
 * unchanged — this file does not duplicate them.
 */

// Module-top env: matches the convention used by OAuth test suites.
process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.test';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import crypto from 'crypto';

import { requireAuth, requireScope, softAuth } from '../auth.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, tokensDao, usersDao } from '../../oauth/dao.js';

// ─── DB setup ─────────────────────────────────────────────────────────────────

const testDbPath = join(
  tmpdir(),
  `foundry-auth-oauth-test-${process.pid}-${Date.now()}.db`
);

let userId: string;
let clientId: string;

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  closeDb();
  getDb(); // creates schema

  const user = usersDao.upsert({ github_login: 'alice', github_id: 10101 });
  userId = user.id;

  const { id } = clientsDao.register({
    name: 'Test Connector',
    redirect_uris: 'https://example.com/cb',
    client_type: 'autonomous',
  });
  clientId = id;
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

// ─── App helpers ──────────────────────────────────────────────────────────────

/**
 * Build a fresh app that exposes req.user / req.client / scopes on the
 * response so assertions can verify the middleware populated them.
 */
function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAuth, (req, res) => {
    res.json({
      success: true,
      user: req.user,
      client: req.client,
    });
  });
  app.get(
    '/read-private',
    requireAuth,
    requireScope('docs:read:private'),
    (req, res) => {
      res.json({ success: true, user: req.user });
    }
  );
  // Generic error handler so thrown errors don't silently 500 with no body
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(500).json({ error: err.message ?? 'internal error' });
    }
  );
  return app;
}

/**
 * Save and restore process.env.FOUNDRY_WRITE_TOKEN between tests.
 */
function withLegacyToken(value: string | undefined, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prev = process.env.FOUNDRY_WRITE_TOKEN;
    if (value === undefined) {
      delete process.env.FOUNDRY_WRITE_TOKEN;
    } else {
      process.env.FOUNDRY_WRITE_TOKEN = value;
    }
    try {
      await fn();
    } finally {
      if (prev === undefined) {
        delete process.env.FOUNDRY_WRITE_TOKEN;
      } else {
        process.env.FOUNDRY_WRITE_TOKEN = prev;
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OAuth happy path
// ═══════════════════════════════════════════════════════════════════════════

describe('requireAuth — OAuth happy path (AC1)', () => {
  it(
    'populates req.user and req.client from a valid access token',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read docs:write',
      });

      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe(userId);
      expect(res.body.user.github_login).toBe('alice');
      expect(res.body.user.scopes).toEqual(['docs:read', 'docs:write']);
      expect(res.body.client.id).toBe(clientId);
      expect(res.body.client.name).toBe('Test Connector');
      expect(res.body.client.client_type).toBe('autonomous');
    })
  );

  it(
    'splits scope string on whitespace and filters empties',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read   docs:read:private',
      });

      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.user.scopes).toEqual(['docs:read', 'docs:read:private']);
    })
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Legacy happy path — verify req.user / req.client populated (AC2 extension)
// ═══════════════════════════════════════════════════════════════════════════

describe('requireAuth — legacy token populates req.user/req.client (AC2)', () => {
  it(
    'legacy FOUNDRY_WRITE_TOKEN match → req.user.id = legacy and all docs scopes',
    withLegacyToken('the-legacy-break-glass-token', async () => {
      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer the-legacy-break-glass-token')
        .expect(200);

      expect(res.body.user.id).toBe('legacy');
      expect(res.body.user.github_login).toBe('legacy');
      expect(res.body.user.scopes).toEqual(
        expect.arrayContaining(['docs:read', 'docs:write', 'docs:read:private'])
      );
      expect(res.body.client.id).toBe('legacy');
      expect(res.body.client.name).toBe('legacy-bearer');
      expect(res.body.client.client_type).toBe('autonomous');
    })
  );

  it(
    'legacy match is tried before OAuth introspect — no DB lookup needed',
    withLegacyToken('legacy-token-value', async () => {
      // Present the legacy token. Even though OAuth DB lookups would
      // fail, the request succeeds via the legacy path.
      const app = makeApp();
      await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer legacy-token-value')
        .expect(200);
    })
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Expired / revoked (AC3, AC4)
// ═══════════════════════════════════════════════════════════════════════════

describe('requireAuth — expired/revoked OAuth tokens', () => {
  it(
    'AC3 — expired access token → 401 with WWW-Authenticate',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read',
        access_ttl_seconds: -1, // already expired
      });

      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(401);

      expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
      expect(res.headers['www-authenticate']).toContain('realm="foundry"');
      expect(res.headers['www-authenticate']).toContain(
        'resource_metadata="https://foundry.test/.well-known/oauth-protected-resource"'
      );
      expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
    })
  );

  it(
    'AC4 — revoked access token → 401 with WWW-Authenticate',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read',
      });
      tokensDao.revoke(access_token);

      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(401);

      expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
    })
  );

  it(
    'introspect-miss keeps legacy-compat body { error: "Unauthorized" }',
    withLegacyToken(undefined, async () => {
      // A well-formed but unknown Bearer token — legacy isn't set, and
      // introspect returns null. Body should remain Unauthorized per
      // backwards-compat with the pre-E12 test contract.
      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer this-is-not-a-real-token')
        .expect(401);

      expect(res.body).toEqual({ error: 'Unauthorized' });
      expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
    })
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Deleted-user / deleted-client edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('requireAuth — deleted user/client references', () => {
  it(
    'valid token referencing a deleted user → 401 invalid_token',
    withLegacyToken(undefined, async () => {
      // Create a throwaway user + token, then delete the user row.
      // Tokens table has a FK to users without ON DELETE CASCADE — disable
      // FK enforcement for this simulated-edge-case setup. The middleware
      // runs normal queries; only the setup disables FK briefly.
      const throwaway = usersDao.upsert({
        github_login: 'throwaway',
        github_id: 777777,
      });
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: throwaway.id,
        scope: 'docs:read',
      });
      const db = getDb();
      db.pragma('foreign_keys = OFF');
      try {
        db.prepare('DELETE FROM users WHERE id = ?').run(throwaway.id);
      } finally {
        db.pragma('foreign_keys = ON');
      }

      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(401);

      expect(res.body.error).toBe('invalid_token');
      expect(res.body.error_description).toMatch(/user/i);
      expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
    })
  );

  it(
    'valid token referencing a deleted client → 401 invalid_token',
    withLegacyToken(undefined, async () => {
      // Register a throwaway client, mint a token, then delete the client.
      const throwaway = clientsDao.register({
        name: 'Throwaway',
        redirect_uris: 'https://example.com/cb',
        client_type: 'interactive',
      });
      const { access_token } = tokensDao.mint({
        client_id: throwaway.id,
        user_id: userId,
        scope: 'docs:read',
      });
      const db = getDb();
      db.pragma('foreign_keys = OFF');
      try {
        db.prepare('DELETE FROM oauth_clients WHERE id = ?').run(throwaway.id);
      } finally {
        db.pragma('foreign_keys = ON');
      }

      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(401);

      expect(res.body.error).toBe('invalid_token');
      expect(res.body.error_description).toMatch(/client/i);
      expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
    })
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// WWW-Authenticate shape on no-token (AC5)
// ═══════════════════════════════════════════════════════════════════════════

describe('requireAuth — WWW-Authenticate header (AC5)', () => {
  it(
    'no Authorization header (with auth configured) → 401 with realm + resource_metadata',
    withLegacyToken('any-legacy-token', async () => {
      const app = makeApp();
      const res = await request(app).get('/protected').expect(401);

      expect(res.body).toEqual({ error: 'Unauthorized' });
      const www = res.headers['www-authenticate'];
      expect(www).toBeDefined();
      expect(www).toContain('Bearer ');
      expect(www).toContain('realm="foundry"');
      expect(www).toContain(
        'resource_metadata="https://foundry.test/.well-known/oauth-protected-resource"'
      );
      // No token presented — no error="invalid_token" attribute.
      expect(www).not.toContain('error=');
    })
  );

  it(
    'malformed Authorization header → 401 no-token shape (no error attribute)',
    withLegacyToken('any-legacy-token', async () => {
      const app = makeApp();
      const res = await request(app)
        .get('/protected')
        .set('Authorization', 'Basic something')
        .expect(401);

      expect(res.body).toEqual({ error: 'Unauthorized' });
      expect(res.headers['www-authenticate']).not.toContain('error=');
    })
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// requireScope
// ═══════════════════════════════════════════════════════════════════════════

describe('requireScope', () => {
  it(
    'AC6 — 403 insufficient_scope when user lacks required scope',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read', // no docs:read:private
      });

      const app = makeApp();
      const res = await request(app)
        .get('/read-private')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(403);

      expect(res.body.error).toBe('insufficient_scope');
      expect(res.body.error_description).toBe('Requires scope: docs:read:private');
      expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
      expect(res.headers['www-authenticate']).toContain('scope="docs:read:private"');
    })
  );

  it(
    '200 when user has the required scope',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read docs:read:private',
      });

      const app = makeApp();
      const res = await request(app)
        .get('/read-private')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.user.scopes).toEqual(
        expect.arrayContaining(['docs:read:private'])
      );
    })
  );

  it(
    'legacy token inherits all three docs scopes → passes requireScope(docs:read:private)',
    withLegacyToken('legacy', async () => {
      const app = makeApp();
      const res = await request(app)
        .get('/read-private')
        .set('Authorization', 'Bearer legacy')
        .expect(200);

      expect(res.body.user.id).toBe('legacy');
    })
  );

  it(
    'dev-mode passthrough (no req.user) → requireScope is a no-op',
    withLegacyToken(undefined, async () => {
      // No env, no header — requireAuth calls next() without populating
      // req.user. requireScope must NOT block in this state (symmetric
      // passthrough so local dev still works).
      const app = makeApp();
      const res = await request(app).get('/read-private').expect(200);
      expect(res.body.success).toBe(true);
    })
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Dev-mode passthrough (AC — regression guard)
// ═══════════════════════════════════════════════════════════════════════════

describe('requireAuth — dev-mode passthrough preserved', () => {
  it(
    'no FOUNDRY_WRITE_TOKEN + no Authorization header → 200 without populating req.user',
    withLegacyToken(undefined, async () => {
      const app = makeApp();
      const res = await request(app).get('/protected').expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user).toBeUndefined();
      expect(res.body.client).toBeUndefined();
    })
  );

  it(
    'no FOUNDRY_WRITE_TOKEN + fake Bearer token → still validated as OAuth (fails)',
    withLegacyToken(undefined, async () => {
      // Dev-mode passthrough is ONLY for unauthenticated requests. A
      // Bearer token in dev mode is still checked and must fail if
      // it's not a real OAuth token.
      const app = makeApp();
      await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer completely-fake-token')
        .expect(401);
    })
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDRY_OAUTH_ISSUER fail-loud
// ═══════════════════════════════════════════════════════════════════════════

describe('requireAuth — FOUNDRY_OAUTH_ISSUER fail-loud', () => {
  it(
    'throws when FOUNDRY_OAUTH_ISSUER is unset at 401 time',
    withLegacyToken('token-value', async () => {
      const prev = process.env.FOUNDRY_OAUTH_ISSUER;
      delete process.env.FOUNDRY_OAUTH_ISSUER;
      try {
        const app = makeApp();
        const res = await request(app).get('/protected').expect(500);
        expect(res.body.error).toMatch(/FOUNDRY_OAUTH_ISSUER/);
      } finally {
        if (prev !== undefined) process.env.FOUNDRY_OAUTH_ISSUER = prev;
      }
    })
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// S9 — softAuth: populates req.user on valid token, never 401s on failure
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a fresh app that uses softAuth and exposes req.user / req.client on
 * the response so assertions can verify the middleware populated them.
 */
function makeSoftAuthApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.get('/soft', softAuth, (req, res) => {
    res.json({
      success: true,
      authenticated: !!req.user,
      user: req.user,
      client: req.client,
    });
  });
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(500).json({ error: err.message ?? 'internal error' });
    }
  );
  return app;
}

describe('softAuth — S9 soft introspection middleware', () => {
  it(
    'no Authorization header → next() with req.user undefined (no 401)',
    withLegacyToken(undefined, async () => {
      const res = await request(makeSoftAuthApp()).get('/soft').expect(200);
      expect(res.body.authenticated).toBe(false);
      expect(res.body.user).toBeUndefined();
      expect(res.body.client).toBeUndefined();
    })
  );

  it(
    'missing header even when legacy token is configured → 200 (no 401)',
    withLegacyToken('some-legacy-token', async () => {
      // Key difference from requireAuth: this scenario 401s under requireAuth
      // but MUST NOT 401 under softAuth (browser anonymous search).
      const res = await request(makeSoftAuthApp()).get('/soft').expect(200);
      expect(res.body.authenticated).toBe(false);
    })
  );

  it(
    'malformed Authorization header → next() with req.user undefined (no 401)',
    withLegacyToken(undefined, async () => {
      const res = await request(makeSoftAuthApp())
        .get('/soft')
        .set('Authorization', 'Basic something')
        .expect(200);
      expect(res.body.authenticated).toBe(false);
    })
  );

  it(
    'unknown/invalid Bearer token → next() with req.user undefined (no 401)',
    withLegacyToken(undefined, async () => {
      const res = await request(makeSoftAuthApp())
        .get('/soft')
        .set('Authorization', 'Bearer this-is-not-a-real-token')
        .expect(200);
      expect(res.body.authenticated).toBe(false);
    })
  );

  it(
    'valid OAuth token → req.user + req.client populated, 200',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read docs:read:private',
      });

      const res = await request(makeSoftAuthApp())
        .get('/soft')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.id).toBe(userId);
      expect(res.body.user.github_login).toBe('alice');
      expect(res.body.user.scopes).toEqual(['docs:read', 'docs:read:private']);
      expect(res.body.client.id).toBe(clientId);
    })
  );

  it(
    'valid legacy token → legacy user/client populated, 200',
    withLegacyToken('legacy-break-glass', async () => {
      const res = await request(makeSoftAuthApp())
        .get('/soft')
        .set('Authorization', 'Bearer legacy-break-glass')
        .expect(200);

      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.id).toBe('legacy');
      expect(res.body.user.scopes).toEqual(
        expect.arrayContaining(['docs:read', 'docs:write', 'docs:read:private'])
      );
    })
  );

  it(
    'revoked Bearer token → next() with req.user undefined (no 401)',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read',
      });
      tokensDao.revoke(access_token);

      const res = await request(makeSoftAuthApp())
        .get('/soft')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.authenticated).toBe(false);
    })
  );

  it(
    'expired Bearer token → next() with req.user undefined (no 401)',
    withLegacyToken(undefined, async () => {
      const { access_token } = tokensDao.mint({
        client_id: clientId,
        user_id: userId,
        scope: 'docs:read',
        access_ttl_seconds: -1,
      });

      const res = await request(makeSoftAuthApp())
        .get('/soft')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.authenticated).toBe(false);
    })
  );
});
