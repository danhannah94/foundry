import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOauthDiscoveryRouter } from '../oauth-discovery.js';

const TEST_ISSUER = 'https://test.foundry.example';

describe('OAuth Discovery Endpoints', () => {
  let app: express.Application;

  beforeEach(() => {
    process.env.FOUNDRY_OAUTH_ISSUER = TEST_ISSUER;
    app = express();
    app.use('/', createOauthDiscoveryRouter());
  });

  describe('GET /.well-known/oauth-protected-resource (RFC 9728)', () => {
    it('should return 200', async () => {
      await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);
    });

    it('should return Content-Type application/json', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return resource equal to FOUNDRY_OAUTH_ISSUER', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.body.resource).toBe(TEST_ISSUER);
    });

    it('should return authorization_servers containing FOUNDRY_OAUTH_ISSUER', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.body.authorization_servers).toEqual([TEST_ISSUER]);
    });

    it('should return bearer_methods_supported: ["header"]', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.body.bearer_methods_supported).toEqual(['header']);
    });

    it('should return the full expected RFC 9728 shape', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      expect(response.body).toEqual({
        resource: TEST_ISSUER,
        authorization_servers: [TEST_ISSUER],
        bearer_methods_supported: ['header'],
      });
    });
  });

  describe('GET /.well-known/oauth-authorization-server (RFC 8414)', () => {
    it('should return 200', async () => {
      await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);
    });

    it('should return Content-Type application/json', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return issuer equal to FOUNDRY_OAUTH_ISSUER', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.issuer).toBe(TEST_ISSUER);
    });

    it('should return correct authorization_endpoint', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.authorization_endpoint).toBe(`${TEST_ISSUER}/oauth/authorize`);
    });

    it('should return correct token_endpoint', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.token_endpoint).toBe(`${TEST_ISSUER}/oauth/token`);
    });

    it('should return correct registration_endpoint', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.registration_endpoint).toBe(`${TEST_ISSUER}/oauth/register`);
    });

    it('should return code_challenge_methods_supported: ["S256"] (PKCE mandatory)', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.code_challenge_methods_supported).toEqual(['S256']);
    });

    it('should return grant_types_supported including authorization_code and refresh_token', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.grant_types_supported).toContain('authorization_code');
      expect(response.body.grant_types_supported).toContain('refresh_token');
    });

    it('should return all three required scopes', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.scopes_supported).toContain('docs:read');
      expect(response.body.scopes_supported).toContain('docs:write');
      expect(response.body.scopes_supported).toContain('docs:read:private');
    });

    it('should return the full expected RFC 8414 shape', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body).toEqual({
        issuer: TEST_ISSUER,
        authorization_endpoint: `${TEST_ISSUER}/oauth/authorize`,
        token_endpoint: `${TEST_ISSUER}/oauth/token`,
        registration_endpoint: `${TEST_ISSUER}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['docs:read', 'docs:write', 'docs:read:private'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      });
    });
  });
});
