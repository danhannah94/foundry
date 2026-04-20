import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { tokensDao, usersDao, clientsDao } from '../oauth/dao.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthClientType = 'interactive' | 'autonomous';

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Strict `Bearer <token>` header parser. Rejects "Bearer", "Bearer  foo"
 * (double space), "Basic foo", and anything without a single-space separator.
 */
const BEARER_RE = /^Bearer ([^\s]+)$/;

// ─── Legacy-token helpers ─────────────────────────────────────────────────────

/**
 * Scopes granted to the legacy FOUNDRY_WRITE_TOKEN. Intentionally broad —
 * pre-OAuth callers had full write access. S9 tightens this per OAuth client.
 */
const LEGACY_SCOPES: string[] = ['docs:read', 'docs:write', 'docs:read:private'];

/**
 * Timing-safe comparison for legacy tokens. Short-circuits on length
 * mismatch (safe; lengths are not secret).
 */
function legacyTokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ─── Auth-enabled detection ───────────────────────────────────────────────────

/**
 * Auth is considered "configured" if either legacy or OAuth knobs are set.
 * When neither is set AND no Authorization header is sent, we fall through
 * as dev-mode passthrough (preserves existing local-dev UX).
 *
 * Note: the existence of an Authorization header on an otherwise-unconfigured
 * dev machine still routes through OAuth validation (and fails), so agents
 * sending fake tokens get 401s rather than silent passthrough.
 */
function isLegacyConfigured(): boolean {
  return !!process.env.FOUNDRY_WRITE_TOKEN;
}

// ─── WWW-Authenticate helpers ─────────────────────────────────────────────────

/**
 * Build the WWW-Authenticate header value for the Bearer-protected resource.
 * Fails loud if FOUNDRY_OAUTH_ISSUER is unset — server misconfiguration per D-spec-1.
 */
function buildWwwAuthenticate(error?: string): string {
  const issuer = process.env.FOUNDRY_OAUTH_ISSUER;
  if (!issuer) {
    throw new Error('FOUNDRY_OAUTH_ISSUER is required but not set');
  }

  const parts = [
    `realm="foundry"`,
    `resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
  ];
  if (error) {
    parts.push(`error="${error}"`);
  }
  return `Bearer ${parts.join(', ')}`;
}

// Missing / malformed Authorization header — no token was meaningfully
// presented. Body is `{ error: 'Unauthorized' }` for backwards-compat
// with the pre-E12 test suite and existing CLI clients that string-match.
function send401NoToken(res: Response): void {
  res.setHeader('WWW-Authenticate', buildWwwAuthenticate());
  res.status(401).json({ error: 'Unauthorized' });
}

// Well-formed Bearer token that failed validation (unknown hash,
// expired, revoked, or legacy-mismatch that also wasn't a real OAuth
// token). WWW-Authenticate signals `error="invalid_token"` per RFC 6750,
// but the JSON body keeps `Unauthorized` for compat with pre-E12 tests.
function send401TokenRejected(res: Response): void {
  res.setHeader('WWW-Authenticate', buildWwwAuthenticate('invalid_token'));
  res.status(401).json({ error: 'Unauthorized' });
}

// Valid token referencing a user/client row that has since been deleted.
// Distinct diagnostic case — use the richer RFC 6750 body since no
// existing tests assert on it.
function send401BrokenReference(res: Response, description: string): void {
  res.setHeader('WWW-Authenticate', buildWwwAuthenticate('invalid_token'));
  res.status(401).json({ error: 'invalid_token', error_description: description });
}

// ─── Token resolution (shared internal) ───────────────────────────────────────

/**
 * Outcome of resolving a Bearer token, shared between requireAuth and softAuth.
 *
 *  - 'ok': valid token; req.user / req.client are ready to populate (on the caller).
 *  - 'invalid_token': well-formed Bearer but the token didn't introspect
 *                     (unknown/expired/revoked, and also not a legacy match).
 *  - 'user_gone' / 'client_gone': token introspected but referenced row deleted.
 */
type TokenResolution =
  | {
      kind: 'ok';
      user: AuthUser;
      client: AuthClient;
    }
  | { kind: 'invalid_token' }
  | { kind: 'user_gone' }
  | { kind: 'client_gone' };

type AuthUser = NonNullable<Request['user']>;
type AuthClient = NonNullable<Request['client']>;

/**
 * Resolve a raw Bearer token to an authenticated user + client, or classify
 * the failure. No side effects — caller decides whether to respond, next(),
 * or populate req.
 *
 * Legacy FOUNDRY_WRITE_TOKEN is tried first (timing-safe compare); on miss
 * we fall through to OAuth introspection. This matches the original
 * requireAuth ordering from S7.
 */
function resolveBearerToken(token: string): TokenResolution {
  // ── Path 1: legacy FOUNDRY_WRITE_TOKEN ─────────────────────────────────────
  const legacyToken = process.env.FOUNDRY_WRITE_TOKEN;
  if (legacyToken && legacyTokenMatches(token, legacyToken)) {
    return {
      kind: 'ok',
      user: {
        id: 'legacy',
        github_login: 'legacy',
        scopes: [...LEGACY_SCOPES],
      },
      client: {
        id: 'legacy',
        name: 'legacy-bearer',
        client_type: 'autonomous',
      },
    };
  }

  // ── Path 2: OAuth Bearer token ─────────────────────────────────────────────
  // introspect returns null for unknown/revoked/expired tokens, and also
  // covers the wrong-legacy-token case that fell through above.
  const info = tokensDao.introspect(token);
  if (!info) {
    return { kind: 'invalid_token' };
  }

  const user = usersDao.findById(info.user_id);
  if (!user) {
    return { kind: 'user_gone' };
  }

  const client = clientsDao.findById(info.client_id);
  if (!client) {
    return { kind: 'client_gone' };
  }

  return {
    kind: 'ok',
    user: {
      id: user.id,
      github_login: user.github_login,
      scopes: info.scope.split(' ').filter(Boolean),
    },
    client: {
      id: client.id,
      name: client.name,
      // DAO persists client_type as string; downstream code expects the narrowed
      // union. Cast is safe given /oauth/register validates to these two values.
      client_type: client.client_type as AuthClientType,
    },
  };
}

// ─── requireAuth ──────────────────────────────────────────────────────────────

/**
 * Dual-auth Bearer middleware.
 *
 * Accepts either:
 *  1. Legacy FOUNDRY_WRITE_TOKEN (break-glass fallback during OAuth rollout)
 *  2. OAuth access token minted via /oauth/token (S6)
 *
 * On success populates `req.user` and `req.client` for downstream
 * middleware / handlers. Exports stays `requireAuth` (D11) — existing
 * callers need no changes.
 *
 * Dev-mode passthrough: if FOUNDRY_WRITE_TOKEN is unset AND the request
 * has no Authorization header, next() is called without populating
 * req.user / req.client. This keeps local dev working without any auth
 * configured. Any request that DOES present a Bearer token will still
 * be validated — fake tokens fail.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Dev-mode passthrough — nothing configured, nothing sent.
  if (!isLegacyConfigured() && !authHeader) {
    // Explicitly null out Node's http built-in `req.client` alias (it
    // points at the underlying Socket). Downstream code treats
    // `req.client` as an AuthClient | undefined and must not see the
    // Socket. `req.user` has no Node alias and is already undefined.
    req.client = undefined;
    return next();
  }

  // Missing header while auth is configured → 401 no-token shape.
  if (!authHeader) {
    return send401NoToken(res);
  }

  const match = BEARER_RE.exec(authHeader);
  if (!match) {
    return send401NoToken(res);
  }
  const token = match[1];

  const outcome = resolveBearerToken(token);
  switch (outcome.kind) {
    case 'ok':
      req.user = outcome.user;
      req.client = outcome.client;
      return next();
    case 'invalid_token':
      return send401TokenRejected(res);
    case 'user_gone':
      return send401BrokenReference(res, 'The access token references a user that no longer exists');
    case 'client_gone':
      return send401BrokenReference(res, 'The access token references a client that no longer exists');
  }
}

// ─── softAuth ─────────────────────────────────────────────────────────────────

/**
 * Soft introspection middleware — populates req.user / req.client on a valid
 * Bearer token, but NEVER 401s on failure.
 *
 * Used by routes that must serve anonymous traffic but want to upgrade the
 * response when a valid token is present — specifically /api/search, which
 * is the only auth-optional route in the system (browser anonymous search
 * is a product requirement).
 *
 * Behavior matrix:
 *   - Missing Authorization header → next() with req.user undefined
 *   - Malformed Bearer header       → next() with req.user undefined
 *   - Unknown/expired/revoked token → next() with req.user undefined
 *   - Deleted user/client reference → next() with req.user undefined
 *   - Valid token                    → req.user + req.client populated, next()
 *
 * Handlers read req.user?.scopes to decide what to return (public-only vs
 * full). Do NOT use this for write routes — those must use requireAuth.
 */
export function softAuth(req: Request, _res: Response, next: NextFunction): void {
  // Start clean — same safety as requireAuth for Node's http built-in
  // req.client alias (points at Socket). Downstream code must not see it.
  req.client = undefined;

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return next();
  }

  const match = BEARER_RE.exec(authHeader);
  if (!match) {
    return next();
  }
  const token = match[1];

  const outcome = resolveBearerToken(token);
  if (outcome.kind === 'ok') {
    req.user = outcome.user;
    req.client = outcome.client;
  }
  // All failure cases fall through with req.user undefined — never 401.
  return next();
}

// ─── requireScope ─────────────────────────────────────────────────────────────

/**
 * Scope gate. Must be used AFTER requireAuth.
 *
 * Returns 403 insufficient_scope if the user is authenticated but lacks
 * the required scope. If req.user is undefined (dev-mode passthrough),
 * behaves as a no-op — symmetric with requireAuth's dev-mode behavior so
 * local dev stays unblocked.
 */
export function requireScope(scope: string): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Dev-mode passthrough — requireAuth left req.user undefined because
    // nothing was configured. Treat as "all scopes granted".
    if (!req.user) {
      return next();
    }

    if (!req.user.scopes.includes(scope)) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer error="insufficient_scope", scope="${scope}"`
      );
      res.status(403).json({
        error: 'insufficient_scope',
        error_description: `Requires scope: ${scope}`,
      });
      return;
    }

    return next();
  };
}

// ─── Startup log ──────────────────────────────────────────────────────────────

/**
 * Log authentication status on server startup.
 */
export function logAuthStatus(): void {
  if (isLegacyConfigured()) {
    console.log('🔒 Authentication enabled for write operations (legacy + OAuth)');
  } else {
    console.log('⚠️ Authentication disabled (dev mode) - set FOUNDRY_WRITE_TOKEN to enable legacy auth; OAuth still validated when presented');
  }
}
