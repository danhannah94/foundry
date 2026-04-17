/**
 * GitHub OAuth callback route.
 *
 * GET /oauth/github/callback
 *   - Validates signed state cookie (set by S5 /oauth/authorize)
 *   - Exchanges code for access token via GitHub
 *   - Fetches user profile from GitHub
 *   - Upserts user into DB
 *   - Resolves scopes
 *   - Issues signed session cookie
 *   - Redirects to /oauth/consent
 */

import { Router, Request, Response } from 'express';
import { exchangeCode, fetchUser, resolveScopes } from '../oauth/github.js';
import { signCookie, verifyCookie } from '../oauth/session.js';
import { usersDao } from '../oauth/dao.js';

// Cookie names (must match what S5 /oauth/authorize sets)
const STATE_COOKIE = 'foundry_oauth_state';
const SESSION_COOKIE = 'foundry_oauth_session';

// TTLs in seconds
const SESSION_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Determine if we're in a production environment where Secure cookies should be set.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Parse cookies from the Cookie header string.
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function createOauthGithubRouter(): Router {
  const router = Router();

  router.get('/oauth/github/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query as { code?: string; state?: string };

    // 1. Validate required query params
    if (!code || !state) {
      return res.status(400).json({ error: 'Missing required query parameters: code, state' });
    }

    // 2. Read and verify the state cookie
    const cookieHeader = req.headers.cookie ?? '';
    const cookies = parseCookies(cookieHeader);
    const rawStateCookie = cookies[STATE_COOKIE];

    if (!rawStateCookie) {
      return res.status(400).json({ error: 'Missing state cookie' });
    }

    const statePaylod = verifyCookie(rawStateCookie);
    if (!statePaylod) {
      return res.status(400).json({ error: 'Invalid or expired state cookie' });
    }

    // Compare state from query param to state from cookie
    if (statePaylod.state !== state) {
      return res.status(400).json({ error: 'State mismatch' });
    }

    // 3. Exchange code for access token
    let accessToken: string;
    try {
      const tokenResponse = await exchangeCode(code);
      accessToken = tokenResponse.access_token;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[oauth/github] Token exchange failed:', message);
      return res.status(502).json({ error: `GitHub token exchange failed: ${message}` });
    }

    // 4. Fetch GitHub user
    let githubUser: { login: string; id: number };
    try {
      githubUser = await fetchUser(accessToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[oauth/github] User fetch failed:', message);
      return res.status(502).json({ error: `GitHub user fetch failed: ${message}` });
    }

    // 5. Upsert user
    const user = usersDao.upsert({
      github_login: githubUser.login,
      github_id: githubUser.id,
    });

    // 6. Resolve scopes
    const scopes = resolveScopes(githubUser.login);

    // 7. Issue signed session cookie
    const sessionExp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    const sessionCookieValue = signCookie({
      user_id: user.id,
      scopes,
      exp: sessionExp,
    });

    const secure = isProduction();
    const cookieAttrs = [
      `${SESSION_COOKIE}=${encodeURIComponent(sessionCookieValue)}`,
      'HttpOnly',
      secure ? 'Secure' : '',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${SESSION_TTL_SECONDS}`,
    ].filter(Boolean).join('; ');

    res.setHeader('Set-Cookie', cookieAttrs);

    // 8. Redirect to consent page (S5 placeholder)
    return res.redirect(302, '/oauth/consent');
  });

  return router;
}
