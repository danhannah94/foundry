import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import { getDb, closeDb } from '../db.js';
import { usersDao, clientsDao, codesDao, tokensDao } from '../oauth/dao.js';

// Each describe block uses its own temp DB via FOUNDRY_DB_PATH
function withTempDb(fn: () => void): void {
  const testDbPath = join(tmpdir(), `foundry-oauth-test-${process.pid}-${Date.now()}.db`);

  beforeEach(() => {
    process.env.FOUNDRY_DB_PATH = testDbPath;
    // Force a fresh DB by closing any existing connection first
    closeDb();
    // Trigger schema creation
    getDb();
  });

  afterEach(() => {
    closeDb();
    try {
      unlinkSync(testDbPath);
    } catch {
      // ignore
    }
    delete process.env.FOUNDRY_DB_PATH;
  });

  fn();
}

// ─── usersDao ─────────────────────────────────────────────────────────────────

describe('usersDao', () => {
  withTempDb(() => {
    it('upsert creates a new user', () => {
      const user = usersDao.upsert({ github_login: 'alice', github_id: 1001 });
      expect(user.id).toBeTruthy();
      expect(user.github_login).toBe('alice');
      expect(user.github_id).toBe(1001);
      expect(user.created_at).toBeTruthy();
      expect(user.updated_at).toBeTruthy();
    });

    it('upsert updates github_login for existing github_id', async () => {
      const first = usersDao.upsert({ github_login: 'alice', github_id: 1001 });
      // Small delay so updated_at differs
      await new Promise((r) => setTimeout(r, 10));
      const second = usersDao.upsert({ github_login: 'alice-renamed', github_id: 1001 });

      expect(second.id).toBe(first.id);
      expect(second.github_login).toBe('alice-renamed');
      expect(second.updated_at >= first.updated_at).toBe(true);
    });

    it('findByGithubId returns the user when found', () => {
      usersDao.upsert({ github_login: 'bob', github_id: 2002 });
      const found = usersDao.findByGithubId(2002);
      expect(found).toBeDefined();
      expect(found!.github_login).toBe('bob');
    });

    it('findByGithubId returns undefined when not found', () => {
      const result = usersDao.findByGithubId(99999);
      expect(result).toBeUndefined();
    });
  });
});

// ─── clientsDao ───────────────────────────────────────────────────────────────

describe('clientsDao', () => {
  withTempDb(() => {
    it('register returns plaintext id and secret', () => {
      const { id, secret } = clientsDao.register({
        name: 'Test App',
        redirect_uris: 'https://example.com/callback',
        client_type: 'confidential',
      });
      expect(id).toBeTruthy();
      expect(id.length).toBe(32);
      expect(secret).toBeTruthy();
    });

    it('findById returns the registered client', () => {
      const { id } = clientsDao.register({
        name: 'My App',
        redirect_uris: 'https://app.example.com/cb',
        client_type: 'public',
      });
      const client = clientsDao.findById(id);
      expect(client).toBeDefined();
      expect(client!.id).toBe(id);
      expect(client!.name).toBe('My App');
      expect(client!.redirect_uris).toBe('https://app.example.com/cb');
      expect(client!.client_type).toBe('public');
    });

    it('findById returns undefined for unknown id', () => {
      const result = clientsDao.findById('nonexistent-id');
      expect(result).toBeUndefined();
    });

    it('verifySecret returns true for correct secret', () => {
      const { id, secret } = clientsDao.register({
        name: 'Verify App',
        redirect_uris: 'https://example.com/cb',
        client_type: 'confidential',
      });
      expect(clientsDao.verifySecret(id, secret)).toBe(true);
    });

    it('verifySecret returns false for wrong secret', () => {
      const { id } = clientsDao.register({
        name: 'Verify App 2',
        redirect_uris: 'https://example.com/cb',
        client_type: 'confidential',
      });
      expect(clientsDao.verifySecret(id, 'wrong-secret')).toBe(false);
    });

    it('verifySecret returns false for unknown id', () => {
      expect(clientsDao.verifySecret('nonexistent', 'any-secret')).toBe(false);
    });

    it('stored secret_hash is not the plaintext secret', () => {
      const { id, secret } = clientsDao.register({
        name: 'Hash Check App',
        redirect_uris: 'https://example.com/cb',
        client_type: 'confidential',
      });
      const client = clientsDao.findById(id);
      expect(client!.secret_hash).not.toBe(secret);
    });
  });
});

// ─── codesDao ─────────────────────────────────────────────────────────────────

describe('codesDao', () => {
  // We need a user and client to satisfy FK constraints
  let client_id: string;
  let user_id: string;

  withTempDb(() => {
    beforeEach(() => {
      const reg = clientsDao.register({
        name: 'Code Test Client',
        redirect_uris: 'https://example.com/cb',
        client_type: 'confidential',
      });
      client_id = reg.id;
      const user = usersDao.upsert({ github_login: 'codeuser', github_id: 3003 });
      user_id = user.id;
    });

    it('mint creates a code and consume returns it', () => {
      const { code } = codesDao.mint({
        client_id,
        user_id,
        scope: 'read',
        redirect_uri: 'https://example.com/cb',
        pkce_challenge: 'challenge-abc',
      });
      expect(code).toBeTruthy();

      const consumed = codesDao.consume(code);
      expect(consumed).not.toBeNull();
      expect(consumed!.code).toBe(code);
      expect(consumed!.client_id).toBe(client_id);
      expect(consumed!.user_id).toBe(user_id);
      expect(consumed!.scope).toBe('read');
      expect(consumed!.consumed_at).toBeTruthy();
    });

    it('consume returns null on second call (already consumed)', () => {
      const { code } = codesDao.mint({
        client_id,
        user_id,
        scope: 'read',
        redirect_uri: 'https://example.com/cb',
        pkce_challenge: 'challenge-xyz',
      });

      const first = codesDao.consume(code);
      expect(first).not.toBeNull();

      const second = codesDao.consume(code);
      expect(second).toBeNull();
    });

    it('consume returns null for expired code (0s TTL)', () => {
      const { code } = codesDao.mint({
        client_id,
        user_id,
        scope: 'read',
        redirect_uri: 'https://example.com/cb',
        pkce_challenge: 'challenge-expired',
        ttl_seconds: 0,
      });

      const result = codesDao.consume(code);
      expect(result).toBeNull();
    });

    it('consume returns null for nonexistent code', () => {
      const result = codesDao.consume('nonexistent-code-12345');
      expect(result).toBeNull();
    });
  });
});

// ─── tokensDao ────────────────────────────────────────────────────────────────

describe('tokensDao', () => {
  let client_id: string;
  let user_id: string;

  withTempDb(() => {
    beforeEach(() => {
      const reg = clientsDao.register({
        name: 'Token Test Client',
        redirect_uris: 'https://example.com/cb',
        client_type: 'confidential',
      });
      client_id = reg.id;
      const user = usersDao.upsert({ github_login: 'tokenuser', github_id: 4004 });
      user_id = user.id;
    });

    it('mint returns plaintext access_token, refresh_token, expires_at', () => {
      const result = tokensDao.mint({ client_id, user_id, scope: 'read' });
      expect(result.access_token).toBeTruthy();
      expect(result.refresh_token).toBeTruthy();
      expect(result.expires_at).toBeTruthy();
    });

    it('stored row uses sha256 hashes, not plaintext tokens', () => {
      const { access_token } = tokensDao.mint({ client_id, user_id, scope: 'read' });
      const db = getDb();
      const row = db.prepare('SELECT * FROM oauth_tokens ORDER BY created_at DESC LIMIT 1').get() as any;
      expect(row.access_token_hash).not.toBe(access_token);
      expect(row.access_token_hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    });

    it('introspect returns TokenInfo for a valid token', () => {
      const { access_token } = tokensDao.mint({ client_id, user_id, scope: 'read' });
      const info = tokensDao.introspect(access_token);
      expect(info).not.toBeNull();
      expect(info!.client_id).toBe(client_id);
      expect(info!.user_id).toBe(user_id);
      expect(info!.scope).toBe('read');
    });

    it('introspect returns null for unknown token', () => {
      const result = tokensDao.introspect('unknown-token-abc');
      expect(result).toBeNull();
    });

    it('introspect returns null for expired token (0s TTL)', () => {
      const { access_token } = tokensDao.mint({
        client_id,
        user_id,
        scope: 'read',
        access_ttl_seconds: 0,
      });
      const result = tokensDao.introspect(access_token);
      expect(result).toBeNull();
    });

    it('introspect returns null for revoked token', () => {
      const { access_token } = tokensDao.mint({ client_id, user_id, scope: 'read' });
      tokensDao.revoke(access_token);
      const result = tokensDao.introspect(access_token);
      expect(result).toBeNull();
    });

    it('revoke sets revoked_at on the token row', () => {
      const { access_token } = tokensDao.mint({ client_id, user_id, scope: 'read' });
      tokensDao.revoke(access_token);
      // Direct DB check
      const db = getDb();
      const row = db.prepare('SELECT * FROM oauth_tokens ORDER BY created_at DESC LIMIT 1').get() as any;
      expect(row.revoked_at).toBeTruthy();
    });

  });
});
