/**
 * OAuth 2.0 Token endpoint (FND-E12-S6).
 *
 * POST /oauth/token — x-www-form-urlencoded body per RFC 6749.
 *
 * Supported grants:
 *   - authorization_code — exchange a code (minted by S5's consent flow) for
 *     access + refresh tokens after validating client creds, PKCE, redirect
 *     URI, and recomputing scopes fresh against FOUNDRY_PRIVATE_DOC_USERS.
 *   - refresh_token — rotate: revoke the presented refresh token and mint a
 *     new access + refresh pair, recomputing scopes fresh. Reuse of an
 *     already-revoked refresh token is rejected as invalid_grant (possible
 *     theft signal). Full-chain revocation on reuse is deferred to v2.
 *
 * Error shape per RFC 6749 §5.2: { error, error_description }.
 * HTTP 400 for all OAuth errors except invalid_client (401) when client
 * authentication itself fails.
 *
 * Notes on DAO adaptation:
 *   The task spec assumed `tokensDao.findByRefreshTokenHash` and a
 *   `tokensDao.revoke(token_id)` that takes a row id. The real DAO exposes
 *   `tokensDao.refresh()` (which hides client_id/scope recomputation) and
 *   `tokensDao.revoke(access_token)`. Since this route needs to verify
 *   client_id ownership AND recompute scopes fresh at rotation time, we use
 *   getDb() directly for the refresh-grant lookup + atomic rotation. Per the
 *   task boundary, the DAO is not modified.
 */

import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import { clientsDao, codesDao, tokensDao, usersDao } from '../oauth/dao.js';
import { resolveScopes } from '../oauth/github.js';
import { getDb } from '../db.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_TTL_SECONDS = 3600;        // 1 hour
const REFRESH_TTL_SECONDS = 2592000;    // 30 days

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pkceChallengeFromVerifier(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Timing-safe string comparison. Falls back to length-mismatch short-circuit
 * (which itself is not timing-sensitive when one side is attacker-controlled
 * and the other is a known stored value — the attacker already knows the
 * expected length class).
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface OAuthError {
  status: number;
  body: { error: string; error_description: string };
}

function err(
  code: string,
  description: string,
  status = 400
): OAuthError {
  return { status, body: { error: code, error_description: description } };
}

function sendErr(res: Response, e: OAuthError): Response {
  // RFC 6749 §5.2: include Cache-Control: no-store and Pragma: no-cache on
  // error responses from the token endpoint.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  return res.status(e.status).json(e.body);
}

/**
 * Intersect stored-on-code scopes with freshly-resolved scopes for the user.
 * If the fresh resolver returns a narrower set (e.g., user lost private
 * access), we emit the intersection. Order follows the code's stored scope.
 */
function intersectScopes(storedScope: string, resolved: string[]): string {
  const resolvedSet = new Set(resolved);
  return storedScope
    .split(' ')
    .filter(Boolean)
    .filter((s) => resolvedSet.has(s))
    .join(' ');
}

// ─── Token row type (for direct getDb lookup) ─────────────────────────────────

interface TokenRow {
  access_token_hash: string;
  refresh_token_hash: string | null;
  client_id: string;
  user_id: string;
  scope: string;
  expires_at: string;
  refresh_expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createOauthTokenRouter(): Router {
  const router = Router();

  router.post(
    '/oauth/token',
    express.urlencoded({ extended: false }),
    (req: Request, res: Response) => {
      // RFC 6749 §5.1: success responses must include Cache-Control: no-store.
      // We set it up front; errors override via sendErr.
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');

      const body = (req.body ?? {}) as Record<string, unknown>;
      const grant_type = typeof body.grant_type === 'string' ? body.grant_type : undefined;

      if (!grant_type) {
        return sendErr(
          res,
          err('invalid_request', 'grant_type is required')
        );
      }

      if (grant_type === 'authorization_code') {
        return handleAuthorizationCode(body, res);
      }
      if (grant_type === 'refresh_token') {
        return handleRefreshToken(body, res);
      }

      return sendErr(
        res,
        err(
          'unsupported_grant_type',
          `grant_type "${grant_type}" is not supported. Supported: authorization_code, refresh_token`
        )
      );
    }
  );

  return router;
}

// ─── Grant: authorization_code ────────────────────────────────────────────────

function handleAuthorizationCode(
  body: Record<string, unknown>,
  res: Response
): Response {
  const code = typeof body.code === 'string' ? body.code : undefined;
  const code_verifier =
    typeof body.code_verifier === 'string' ? body.code_verifier : undefined;
  const client_id = typeof body.client_id === 'string' ? body.client_id : undefined;
  const client_secret =
    typeof body.client_secret === 'string' ? body.client_secret : undefined;
  const redirect_uri =
    typeof body.redirect_uri === 'string' ? body.redirect_uri : undefined;

  if (!code || !code_verifier || !client_id || !client_secret || !redirect_uri) {
    return sendErr(
      res,
      err(
        'invalid_request',
        'authorization_code grant requires code, code_verifier, client_id, client_secret, redirect_uri'
      )
    );
  }

  // 1. Validate client credentials
  if (!clientsDao.verifySecret(client_id, client_secret)) {
    return sendErr(
      res,
      err('invalid_client', 'Invalid client credentials', 401)
    );
  }

  // 2. Atomically consume code (consume() returns null if unknown / already
  //    consumed / expired)
  const consumed = codesDao.consume(code);
  if (!consumed) {
    return sendErr(
      res,
      err(
        'invalid_grant',
        'Authorization code is invalid, already used, or expired'
      )
    );
  }

  // 2b. Ensure the code belongs to the requesting client. This catches a
  //     confused-deputy attempt where a legitimate client_id/secret pair is
  //     used to redeem another client's code. RFC 6749 §4.1.3.
  if (!timingSafeEqualStr(consumed.client_id, client_id)) {
    return sendErr(
      res,
      err('invalid_grant', 'Authorization code was not issued to this client')
    );
  }

  // 3. Verify PKCE
  const expectedChallenge = pkceChallengeFromVerifier(code_verifier);
  if (!timingSafeEqualStr(expectedChallenge, consumed.pkce_challenge)) {
    return sendErr(
      res,
      err('invalid_grant', 'PKCE verification failed')
    );
  }

  // 4. Verify redirect_uri matches the one stored at mint
  if (!timingSafeEqualStr(redirect_uri, consumed.redirect_uri)) {
    return sendErr(
      res,
      err('invalid_grant', 'redirect_uri does not match authorization request')
    );
  }

  // 5. Recompute scopes fresh (per D-schema-2) and intersect with stored
  const user = usersDao.findById(consumed.user_id);
  if (!user) {
    // Code points to a user that has since been deleted. Treat as invalid.
    return sendErr(
      res,
      err('invalid_grant', 'Authorization code references an unknown user')
    );
  }
  const resolved = resolveScopes(user.github_login);
  const finalScope = intersectScopes(consumed.scope, resolved);
  if (finalScope.length === 0) {
    // User no longer has any of the approved scopes.
    return sendErr(
      res,
      err('invalid_grant', 'No authorized scopes remain for this user')
    );
  }

  // 6. Mint tokens
  const minted = tokensDao.mint({
    client_id,
    user_id: consumed.user_id,
    scope: finalScope,
    access_ttl_seconds: ACCESS_TTL_SECONDS,
    refresh_ttl_seconds: REFRESH_TTL_SECONDS,
  });

  // 7. Respond per RFC 6749 §5.1
  return res.status(200).json({
    access_token: minted.access_token,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: minted.refresh_token,
    scope: finalScope,
  });
}

// ─── Grant: refresh_token ─────────────────────────────────────────────────────

function handleRefreshToken(
  body: Record<string, unknown>,
  res: Response
): Response {
  const refresh_token =
    typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
  const client_id = typeof body.client_id === 'string' ? body.client_id : undefined;
  const client_secret =
    typeof body.client_secret === 'string' ? body.client_secret : undefined;

  if (!refresh_token || !client_id || !client_secret) {
    return sendErr(
      res,
      err(
        'invalid_request',
        'refresh_token grant requires refresh_token, client_id, client_secret'
      )
    );
  }

  // 1. Validate client credentials
  if (!clientsDao.verifySecret(client_id, client_secret)) {
    return sendErr(
      res,
      err('invalid_client', 'Invalid client credentials', 401)
    );
  }

  // 2-5. Look up, verify, and atomically revoke inside a transaction so that
  //      two concurrent refreshes can't both succeed. We use getDb() directly
  //      here because tokensDao.refresh() doesn't expose client_id
  //      verification or fresh-scope recomputation at rotation time, and the
  //      task boundary forbids DAO changes.
  const db = getDb();
  const refresh_hash = sha256Hex(refresh_token);
  const now = new Date().toISOString();

  let rotated: {
    access_token: string;
    refresh_token: string;
    user_id: string;
    scope: string;
  } | null = null;

  // errorCode captures the specific cause so we can return a descriptive
  // error_description after the transaction commits/rolls back. Keeps error
  // paths clean and ensures the revocation+mint pair is atomic.
  let errorCode: OAuthError | null = null;

  const doRotation = db.transaction(() => {
    const row = db
      .prepare('SELECT * FROM oauth_tokens WHERE refresh_token_hash = ?')
      .get(refresh_hash) as TokenRow | undefined;

    // 2. Unknown refresh token
    if (!row) {
      errorCode = err('invalid_grant', 'Refresh token is invalid');
      return;
    }

    // 3a. Already revoked (rotation reuse signal — possible theft).
    if (row.revoked_at !== null) {
      errorCode = err(
        'invalid_grant',
        'Refresh token has already been used or revoked'
      );
      return;
    }

    // 3b. Expired
    if (row.refresh_expires_at !== null && row.refresh_expires_at <= now) {
      errorCode = err('invalid_grant', 'Refresh token has expired');
      return;
    }

    // 4. Cross-client attempt
    if (!timingSafeEqualStr(row.client_id, client_id)) {
      errorCode = err(
        'invalid_grant',
        'Refresh token was not issued to this client'
      );
      return;
    }

    // 5. Atomic revoke — flip revoked_at on the presented token.
    //    We filter on `revoked_at IS NULL` as a defensive check against a
    //    racing rotation: if the other tx beat us to it, changes will be 0
    //    and we bail.
    const revokeResult = db
      .prepare(
        'UPDATE oauth_tokens SET revoked_at = ? WHERE refresh_token_hash = ? AND revoked_at IS NULL'
      )
      .run(now, refresh_hash);

    if (revokeResult.changes === 0) {
      // Another concurrent refresh won the race; treat as reuse.
      errorCode = err(
        'invalid_grant',
        'Refresh token has already been used or revoked'
      );
      return;
    }

    // 6. Recompute scopes fresh for this user
    const user = usersDao.findById(row.user_id);
    if (!user) {
      errorCode = err(
        'invalid_grant',
        'Refresh token references an unknown user'
      );
      return;
    }
    const resolved = resolveScopes(user.github_login);
    const finalScope = intersectScopes(row.scope, resolved);
    if (finalScope.length === 0) {
      errorCode = err(
        'invalid_grant',
        'No authorized scopes remain for this user'
      );
      return;
    }

    // 7. Mint new tokens inside the same transaction
    const minted = tokensDao.mint({
      client_id,
      user_id: row.user_id,
      scope: finalScope,
      access_ttl_seconds: ACCESS_TTL_SECONDS,
      refresh_ttl_seconds: REFRESH_TTL_SECONDS,
    });

    rotated = {
      access_token: minted.access_token,
      refresh_token: minted.refresh_token,
      user_id: row.user_id,
      scope: finalScope,
    };
  });

  doRotation();

  if (errorCode) {
    return sendErr(res, errorCode);
  }

  if (!rotated) {
    // Defensive — should be unreachable
    return sendErr(res, err('server_error', 'Rotation failed', 500));
  }

  const out = rotated as {
    access_token: string;
    refresh_token: string;
    user_id: string;
    scope: string;
  };

  return res.status(200).json({
    access_token: out.access_token,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: out.refresh_token,
    scope: out.scope,
  });
}
