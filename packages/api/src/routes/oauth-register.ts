import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { clientsDao } from '../oauth/dao.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegisterBody {
  client_name?: unknown;
  redirect_uris?: unknown;
  client_type?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HTTPS_RE = /^https:\/\/.+/;
const LOCALHOST_RE = /^http:\/\/localhost(:\d+)?(\/.*)?$/;

function isValidRedirectUri(uri: string): boolean {
  return HTTPS_RE.test(uri) || LOCALHOST_RE.test(uri);
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createOauthRegisterRouter(): Router {
  const router = Router();

  router.post('/oauth/register', (req: Request<{}, {}, RegisterBody>, res: Response) => {
    // ── Bearer gate ──────────────────────────────────────────────────────────
    //
    // Fail loud if the env var is missing — this is a misconfiguration, not a
    // client error. The error propagates to Express's global error handler and
    // returns 500; no RFC 7591 body is appropriate here.
    const dcrToken = process.env.FOUNDRY_DCR_TOKEN;
    if (!dcrToken) {
      throw new Error('FOUNDRY_DCR_TOKEN is not set — server misconfiguration');
    }

    const authHeader = req.headers.authorization ?? '';
    const match = authHeader.match(/^Bearer (.+)$/);
    const provided = match ? match[1] : '';

    // Timing-safe comparison — lengths must match to avoid short-circuit leaks
    if (
      provided.length !== dcrToken.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(dcrToken))
    ) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    // ── Body validation ──────────────────────────────────────────────────────

    const { client_name, redirect_uris, client_type, grant_types } = req.body;

    // client_name: required, string, max 100 chars
    if (client_name === undefined || client_name === null) {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'client_name is required',
      });
    }
    if (typeof client_name !== 'string' || client_name.trim() === '') {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'client_name must be a non-empty string',
      });
    }
    if (client_name.length > 100) {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'client_name must not exceed 100 characters',
      });
    }

    // redirect_uris: required, non-empty array
    if (redirect_uris === undefined || redirect_uris === null) {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris is required',
      });
    }
    if (!Array.isArray(redirect_uris)) {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris must be an array',
      });
    }
    if (redirect_uris.length === 0) {
      return res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris must contain at least one URI',
      });
    }
    for (const uri of redirect_uris) {
      if (typeof uri !== 'string' || !isValidRedirectUri(uri)) {
        return res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri must be https:// or http://localhost: got "${uri}"`,
        });
      }
    }

    // client_type: required, 'interactive' | 'autonomous'
    if (client_type === undefined || client_type === null) {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'client_type is required',
      });
    }
    if (client_type !== 'interactive' && client_type !== 'autonomous') {
      return res.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'client_type must be "interactive" or "autonomous"',
      });
    }

    // grant_types: optional; if present must include 'authorization_code'
    if (grant_types !== undefined && grant_types !== null) {
      if (!Array.isArray(grant_types) || !grant_types.includes('authorization_code')) {
        return res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: 'grant_types must include "authorization_code"',
        });
      }
    }

    // ── Registration ─────────────────────────────────────────────────────────

    // The DAO takes redirect_uris as a string (joins with space per OAuth convention)
    const { id: client_id, secret: client_secret } = clientsDao.register({
      name: client_name,
      redirect_uris: (redirect_uris as string[]).join(' '),
      client_type: client_type as string,
    });

    return res.status(201).json({
      client_id,
      client_secret,
      client_name,
      redirect_uris,
      client_type,
      registration_access_token: null,
    });
  });

  return router;
}
