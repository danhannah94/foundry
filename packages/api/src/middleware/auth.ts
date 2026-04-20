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

  // ── Path 1: legacy FOUNDRY_WRITE_TOKEN ─────────────────────────────────────
  const legacyToken = process.env.FOUNDRY_WRITE_TOKEN;
  if (legacyToken && legacyTokenMatches(token, legacyToken)) {
    req.user = {
      id: 'legacy',
      github_login: 'legacy',
      scopes: [...LEGACY_SCOPES],
    };
    req.client = {
      id: 'legacy',
      name: 'legacy-bearer',
      client_type: 'autonomous',
    };
    return next();
  }

  // ── Path 2: OAuth Bearer token ─────────────────────────────────────────────
  // introspect returns null for unknown/revoked/expired tokens, and also
  // covers the wrong-legacy-token case that fell through above.
  const info = tokensDao.introspect(token);
  if (!info) {
    return send401TokenRejected(res);
  }

  const user = usersDao.findById(info.user_id);
  if (!user) {
    return send401BrokenReference(res, 'The access token references a user that no longer exists');
  }

  const client = clientsDao.findById(info.client_id);
  if (!client) {
    return send401BrokenReference(res, 'The access token references a client that no longer exists');
  }

  req.user = {
    id: user.id,
    github_login: user.github_login,
    scopes: info.scope.split(' ').filter(Boolean),
  };
  req.client = {
    id: client.id,
    name: client.name,
    // DAO persists client_type as string; downstream code expects the narrowed
    // union. Cast is safe given /oauth/register validates to these two values.
    client_type: client.client_type as AuthClientType,
  };
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
