/**
 * Express Request type augmentation for OAuth-aware auth middleware.
 *
 * `requireAuth` (packages/api/src/middleware/auth.ts) populates `req.user`
 * and `req.client` after successfully validating either an OAuth Bearer
 * token or the legacy FOUNDRY_WRITE_TOKEN. Downstream middleware (e.g.
 * requireScope) and route handlers read these fields for identity and
 * scope checks.
 *
 * Both fields are optional because in dev mode (no FOUNDRY_WRITE_TOKEN
 * configured AND no Authorization header on the request), requireAuth
 * calls next() without populating identity.
 */

export interface AuthUser {
  id: string;
  github_login: string;
  scopes: string[];
}

export interface AuthClient {
  id: string;
  name: string;
  client_type: 'interactive' | 'autonomous';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      client?: AuthClient;
    }
  }
}
