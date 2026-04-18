/**
 * GitHub OAuth helpers — pure functions, no side effects, no module-load env checks.
 * Fail loud at call time if required env vars are absent.
 */

// ─── buildAuthorizeUrl ────────────────────────────────────────────────────────

/**
 * Returns the GitHub OAuth authorization URL with all required params.
 * Throws if FOUNDRY_OAUTH_ISSUER is unset at call time.
 */
export function buildAuthorizeUrl(state: string): string {
  const issuer = process.env.FOUNDRY_OAUTH_ISSUER;
  if (!issuer) {
    throw new Error('FOUNDRY_OAUTH_ISSUER is required but not set');
  }
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error('GITHUB_OAUTH_CLIENT_ID is required but not set');
  }

  const redirectUri = `${issuer}/oauth/github/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'read:user',
    state,
    redirect_uri: redirectUri,
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

// ─── exchangeCode ─────────────────────────────────────────────────────────────

/**
 * Exchange a GitHub OAuth code for an access token.
 * Throws on non-200 response or missing access_token in the response.
 */
export async function exchangeCode(code: string): Promise<{ access_token: string }> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error('GITHUB_OAUTH_CLIENT_ID is required but not set');
  }
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error('GITHUB_OAUTH_CLIENT_SECRET is required but not set');
  }

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as Record<string, unknown>;
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error(`GitHub token exchange returned no access_token: ${JSON.stringify(data)}`);
  }

  return { access_token: data.access_token };
}

// ─── fetchUser ────────────────────────────────────────────────────────────────

/**
 * Fetch the authenticated GitHub user's login and id.
 * Throws on non-200 response.
 */
export async function fetchUser(token: string): Promise<{ login: string; id: number }> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub user fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as Record<string, unknown>;
  return {
    login: data.login as string,
    id: data.id as number,
  };
}

// ─── resolveScopes ────────────────────────────────────────────────────────────

/**
 * Resolve OAuth scopes for a given GitHub login.
 * Reads FOUNDRY_PRIVATE_DOC_USERS (comma-separated logins) at call time — no caching.
 */
export function resolveScopes(github_login: string): string[] {
  const privateUsers = (process.env.FOUNDRY_PRIVATE_DOC_USERS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (privateUsers.includes(github_login)) {
    return ['docs:read', 'docs:write', 'docs:read:private'];
  }
  return ['docs:read', 'docs:write'];
}
