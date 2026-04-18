/**
 * OAuth 2.0 Authorization endpoint + Consent page.
 *
 * GET  /oauth/authorize  — entry point; validates params, stashes pending
 *                          request in a signed cookie, redirects to GitHub
 *                          (if no session) or renders consent page.
 *
 * POST /oauth/consent    — form submit from consent page; mints auth code on
 *                          approve, returns access_denied on deny.
 *
 * CSRF: the signed session cookie IS the CSRF guard. There is no separate
 * token field — the form only has effect when the session cookie matches
 * (same origin, HttpOnly, SameSite=Lax). Per decision D-S5-1 consent is
 * shown on every authorization flow; no oauth_consents table.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express, { Router, Request, Response } from 'express';
import { buildAuthorizeUrl } from '../oauth/github.js';
import { signCookie, verifyCookie } from '../oauth/session.js';
import { clientsDao, codesDao, usersDao } from '../oauth/dao.js';
import crypto from 'crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SESSION_COOKIE = 'foundry_oauth_session';
const PENDING_COOKIE = 'foundry_oauth_pending';
const STATE_COOKIE   = 'foundry_oauth_state';

const SESSION_TTL_SECONDS = 60 * 60;      // 1 hour
const PENDING_TTL_SECONDS = 10 * 60;      // 10 minutes

const SUPPORTED_SCOPES = new Set(['docs:read', 'docs:write', 'docs:read:private']);

// Regex: 43–128 url-safe base64 characters (S256 PKCE challenge)
const CODE_CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

// ─── Consent HTML template ────────────────────────────────────────────────────

const CONSENT_HTML = readFileSync(
  join(__dirname, '../oauth/consent.html'),
  'utf8'
);

// ─── Scope label map ──────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<string, string> = {
  'docs:read':         'Read public docs',
  'docs:write':        'Write annotations',
  'docs:read:private': 'Read private docs',
};

// Scope icons (inline SVG checkmarks — keep the HTML self-contained)
function scopeItemHtml(scope: string): string {
  const label = SCOPE_LABELS[scope] ?? scope;
  return `<li>
        <svg class="scope-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8l3.5 3.5 6.5-7" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${escapeHtml(label)}
      </li>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderConsent(opts: {
  clientName: string;
  githubLogin: string;
  scopes: string[];
}): string {
  const scopeItems = opts.scopes.map(scopeItemHtml).join('\n      ');
  return CONSENT_HTML
    .replace(/\{\{CLIENT_NAME\}\}/g, escapeHtml(opts.clientName))
    .replace(/\{\{GITHUB_LOGIN\}\}/g, escapeHtml(opts.githubLogin))
    .replace('{{SCOPE_ITEMS}}', scopeItems);
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return result;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function setCookieHeader(
  name: string,
  value: string,
  maxAge: number,
  sameSite: 'Lax' | 'None' = 'Lax'
): string {
  const secure = isProduction();
  return [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    secure ? 'Secure' : '',
    `SameSite=${sameSite}`,
    'Path=/',
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ');
}

// ─── Pending session types ────────────────────────────────────────────────────

interface PendingOAuthRequest {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  code_challenge: string;
  exp: number;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createOauthRouter(): Router {
  const router = Router();

  // ── GET /oauth/authorize ────────────────────────────────────────────────────

  router.get('/oauth/authorize', (req: Request, res: Response) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      scope,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query as Record<string, string | undefined>;

    // 1a. Basic required params
    if (!client_id || !redirect_uri || !response_type || !scope || !state || !code_challenge || !code_challenge_method) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameter(s): client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method',
      });
    }

    if (response_type !== 'code') {
      return res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only response_type=code is supported',
      });
    }

    // 1b. Validate client_id and redirect_uri — do NOT redirect on these errors
    //     (per RFC 6749 §4.1.2.1 — never redirect to an unregistered URI)
    const client = clientsDao.findById(client_id);
    if (!client) {
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Unknown client_id',
      });
    }

    const registeredUris = client.redirect_uris.split(' ').map(u => u.trim()).filter(Boolean);
    if (!registeredUris.includes(redirect_uri)) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'redirect_uri does not match a registered URI for this client',
      });
    }

    // From here, errors that are not client-id / redirect_uri mismatches CAN
    // be sent as query-string redirects per spec. We keep them as JSON 400s
    // for clarity (MCP clients parse JSON; browser flows see the 302 to GitHub
    // before user interaction, so these are programmer errors).

    // 2. PKCE validation
    if (code_challenge_method !== 'S256') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Only code_challenge_method=S256 is supported',
      });
    }

    if (!CODE_CHALLENGE_RE.test(code_challenge)) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_challenge must be 43–128 url-safe base64 characters',
      });
    }

    // 3. Scope validation
    const requestedScopes = scope.split(' ').filter(Boolean);
    if (requestedScopes.length === 0) {
      return res.status(400).json({
        error: 'invalid_scope',
        error_description: 'scope is empty',
      });
    }
    for (const s of requestedScopes) {
      if (!SUPPORTED_SCOPES.has(s)) {
        return res.status(400).json({
          error: 'invalid_scope',
          error_description: `Unsupported scope: ${s}. Supported: ${[...SUPPORTED_SCOPES].join(', ')}`,
        });
      }
    }

    // 4. Stash pending request in signed cookie
    const pendingExp = Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS;
    const pending: PendingOAuthRequest = {
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      exp: pendingExp,
    };
    const pendingCookieValue = signCookie(pending);

    // 5. Check for existing user session
    const cookies = parseCookies(req.headers.cookie ?? '');
    const rawSession = cookies[SESSION_COOKIE];
    const session = rawSession ? verifyCookie(rawSession) : null;

    const userId = typeof session?.user_id === 'string' ? session.user_id : null;

    // Set the pending cookie in both branches
    const pendingCookieHeader = setCookieHeader(PENDING_COOKIE, pendingCookieValue, PENDING_TTL_SECONDS);

    if (!userId) {
      // 5a. No session — redirect to GitHub. Generate a new state nonce for the
      //     GitHub leg and stash it in a state cookie (same pattern as S2 expects).
      const githubState = crypto.randomBytes(16).toString('base64url');
      const stateExp = Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS;
      const stateCookieValue = signCookie({ state: githubState, exp: stateExp });
      const stateCookieHeader = setCookieHeader(STATE_COOKIE, stateCookieValue, PENDING_TTL_SECONDS);

      res.setHeader('Set-Cookie', [pendingCookieHeader, stateCookieHeader]);
      return res.redirect(302, buildAuthorizeUrl(githubState));
    }

    // 5b. User already authenticated — render consent page
    const user = usersDao.findById(userId);
    if (!user) {
      // Session references a deleted user — treat as unauthenticated
      const githubState = crypto.randomBytes(16).toString('base64url');
      const stateExp = Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS;
      const stateCookieValue = signCookie({ state: githubState, exp: stateExp });
      const stateCookieHeader = setCookieHeader(STATE_COOKIE, stateCookieValue, PENDING_TTL_SECONDS);

      res.setHeader('Set-Cookie', [pendingCookieHeader, stateCookieHeader]);
      return res.redirect(302, buildAuthorizeUrl(githubState));
    }

    res.setHeader('Set-Cookie', pendingCookieHeader);
    const html = renderConsent({
      clientName: client.name,
      githubLogin: user.github_login,
      scopes: requestedScopes,
    });
    return res.status(200).send(html);
  });

  // ── POST /oauth/consent ─────────────────────────────────────────────────────

  router.post('/oauth/consent', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    // Read session and pending cookies
    const cookies = parseCookies(req.headers.cookie ?? '');

    const rawSession = cookies[SESSION_COOKIE];
    const rawPending = cookies[PENDING_COOKIE];

    if (!rawSession || !rawPending) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing session or pending OAuth cookie — authorization flow must be restarted',
      });
    }

    const session = verifyCookie(rawSession);
    const pending = verifyCookie(rawPending) as PendingOAuthRequest | null;

    if (!session || !pending) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Session or pending OAuth cookie is invalid or expired',
      });
    }

    const userId = typeof session.user_id === 'string' ? session.user_id : null;
    if (!userId) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'No user_id in session',
      });
    }

    const { action } = req.body as { action?: string };

    const redirectBase = pending.redirect_uri;
    const state = pending.state;

    if (action === 'deny') {
      const params = new URLSearchParams({ error: 'access_denied', ...(state ? { state } : {}) });
      return res.redirect(302, `${redirectBase}?${params.toString()}`);
    }

    if (action !== 'approve') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'action must be "approve" or "deny"',
      });
    }

    // Approve: mint authorization code
    const { code } = codesDao.mint({
      client_id: pending.client_id,
      user_id: userId,
      scope: pending.scope,
      redirect_uri: pending.redirect_uri,
      pkce_challenge: pending.code_challenge,
    });

    const params = new URLSearchParams({ code, ...(state ? { state } : {}) });
    return res.redirect(302, `${redirectBase}?${params.toString()}`);
  });

  return router;
}
