import { Router } from 'express';

/**
 * Creates the OAuth discovery router.
 *
 * Implements RFC 9728 (oauth-protected-resource) and RFC 8414
 * (oauth-authorization-server) metadata endpoints. These are static JSON
 * documents mounted at the app root so MCP clients and generic OAuth clients
 * can discover AS capabilities without prior configuration.
 *
 * No auth required — discovery endpoints must be publicly accessible per spec.
 * No DB access — all values are derived from the FOUNDRY_OAUTH_ISSUER env var.
 */
export function createOauthDiscoveryRouter(): Router {
  const router = Router();

  // RFC 9728 — OAuth 2.0 Protected Resource Metadata
  router.get('/.well-known/oauth-protected-resource', (_req, res) => {
    const issuer = process.env.FOUNDRY_OAUTH_ISSUER!;
    res.json({
      resource: issuer,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
    });
  });

  // RFC 8414 — OAuth 2.0 Authorization Server Metadata
  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    const issuer = process.env.FOUNDRY_OAUTH_ISSUER!;
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['docs:read', 'docs:write', 'docs:read:private'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    });
  });

  return router;
}
