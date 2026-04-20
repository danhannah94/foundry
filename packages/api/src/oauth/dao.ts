import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '../db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  github_login: string;
  github_id: number;
  created_at: string;
  updated_at: string;
}

export interface OAuthClient {
  id: string;
  secret_hash: string;
  name: string;
  redirect_uris: string;
  client_type: string;
  created_at: string;
  last_used_at: string | null;
}

export interface AuthCode {
  code: string;
  client_id: string;
  user_id: string;
  scope: string;
  redirect_uri: string;
  pkce_challenge: string;
  pkce_method: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface TokenInfo {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function futureIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

// ─── usersDao ─────────────────────────────────────────────────────────────────

export const usersDao = {
  findById(id: string): User | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as User | undefined;
  },

  findByGithubId(github_id: number): User | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM users WHERE github_id = ?')
      .get(github_id) as User | undefined;
  },

  upsert({ github_login, github_id }: { github_login: string; github_id: number }): User {
    const db = getDb();
    const now = nowIso();
    const existing = usersDao.findByGithubId(github_id);

    if (existing) {
      db.prepare(
        'UPDATE users SET github_login = ?, updated_at = ? WHERE github_id = ?'
      ).run(github_login, now, github_id);
      return db
        .prepare('SELECT * FROM users WHERE github_id = ?')
        .get(github_id) as User;
    }

    const id = createId();
    db.prepare(
      'INSERT INTO users (id, github_login, github_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, github_login, github_id, now, now);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User;
  },
};

// ─── clientsDao ───────────────────────────────────────────────────────────────

export const clientsDao = {
  register({
    name,
    redirect_uris,
    client_type,
  }: {
    name: string;
    redirect_uris: string;
    client_type: string;
  }): { id: string; secret: string } {
    const db = getDb();
    const id = crypto.randomBytes(16).toString('hex'); // 32-char hex
    const secret = randomToken();
    const secret_hash = bcrypt.hashSync(secret, 10);
    const now = nowIso();

    db.prepare(
      'INSERT INTO oauth_clients (id, secret_hash, name, redirect_uris, client_type, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, secret_hash, name, redirect_uris, client_type, now);

    return { id, secret };
  },

  findById(id: string): OAuthClient | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM oauth_clients WHERE id = ?')
      .get(id) as OAuthClient | undefined;
  },

  verifySecret(id: string, secret: string): boolean {
    const client = clientsDao.findById(id);
    if (!client) return false;
    return bcrypt.compareSync(secret, client.secret_hash);
  },
};

// ─── codesDao ─────────────────────────────────────────────────────────────────

export const codesDao = {
  mint({
    client_id,
    user_id,
    scope,
    redirect_uri,
    pkce_challenge,
    ttl_seconds = 600,
  }: {
    client_id: string;
    user_id: string;
    scope: string;
    redirect_uri: string;
    pkce_challenge: string;
    ttl_seconds?: number;
  }): { code: string } {
    const db = getDb();
    const code = randomToken();
    const expires_at = futureIso(ttl_seconds);
    const now = nowIso();

    db.prepare(
      `INSERT INTO oauth_authorization_codes
        (code, client_id, user_id, scope, redirect_uri, pkce_challenge, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(code, client_id, user_id, scope, redirect_uri, pkce_challenge, expires_at);

    return { code };
  },

  consume(code: string): AuthCode | null {
    const db = getDb();
    const now = nowIso();

    // Atomic check-and-set: only update rows that are not yet consumed and not yet expired
    const result = db
      .prepare(
        `UPDATE oauth_authorization_codes
         SET consumed_at = ?
         WHERE code = ?
           AND consumed_at IS NULL
           AND expires_at > ?`
      )
      .run(now, code, now);

    if (result.changes === 0) {
      // Already consumed, expired, or not found
      return null;
    }

    return db
      .prepare('SELECT * FROM oauth_authorization_codes WHERE code = ?')
      .get(code) as AuthCode;
  },
};

// ─── tokensDao ────────────────────────────────────────────────────────────────

export const tokensDao = {
  mint({
    client_id,
    user_id,
    scope,
    access_ttl_seconds = 3600,
    refresh_ttl_seconds = 2592000, // 30 days
  }: {
    client_id: string;
    user_id: string;
    scope: string;
    access_ttl_seconds?: number;
    refresh_ttl_seconds?: number;
  }): { access_token: string; refresh_token: string; expires_at: string } {
    const db = getDb();
    const access_token = randomToken();
    const refresh_token = randomToken();
    const access_token_hash = sha256(access_token);
    const refresh_token_hash = sha256(refresh_token);
    const expires_at = futureIso(access_ttl_seconds);
    const refresh_expires_at = futureIso(refresh_ttl_seconds);
    const now = nowIso();

    db.prepare(
      `INSERT INTO oauth_tokens
        (access_token_hash, refresh_token_hash, client_id, user_id, scope, expires_at, refresh_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      access_token_hash,
      refresh_token_hash,
      client_id,
      user_id,
      scope,
      expires_at,
      refresh_expires_at,
      now
    );

    return { access_token, refresh_token, expires_at };
  },

  introspect(access_token: string): TokenInfo | null {
    const db = getDb();
    const hash = sha256(access_token);
    const now = nowIso();

    const row = db
      .prepare('SELECT * FROM oauth_tokens WHERE access_token_hash = ?')
      .get(hash) as TokenInfo | undefined;

    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (row.expires_at <= now) return null;

    return row;
  },

  revoke(access_token: string): void {
    const db = getDb();
    const hash = sha256(access_token);
    const now = nowIso();
    db.prepare(
      'UPDATE oauth_tokens SET revoked_at = ? WHERE access_token_hash = ?'
    ).run(now, hash);
  },
};
