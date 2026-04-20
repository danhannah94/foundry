/**
 * Shared context type for transport-agnostic service functions.
 *
 * Every service function takes an AuthContext as its first argument. The
 * caller (Express route handler, MCP tool handler, test) is responsible
 * for populating user/client — services never touch Express types.
 *
 * Both fields are optional because /api/search serves anonymous traffic
 * (softAuth) and a few HTTP flows fall through without auth populated
 * (dev mode). Services that require identity should check for undefined
 * and throw an appropriate domain error (or just fall back to the
 * documented 'anonymous' user_id, as existing HTTP handlers already do).
 *
 * The shape matches the Express Request augmentation in
 * `types/express.d.ts` so `{ user: req.user, client: req.client }` is a
 * valid AuthContext.
 */

export interface ServiceAuthUser {
  id: string;
  github_login: string;
  scopes: string[];
}

export interface ServiceAuthClient {
  id: string;
  name: string;
  client_type: 'interactive' | 'autonomous';
}

export interface AuthContext {
  user?: ServiceAuthUser;
  client?: ServiceAuthClient;
}
