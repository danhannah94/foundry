import Database from 'better-sqlite3';
import { join } from 'path';
import { migrateDocPaths } from './migrations/normalize-paths.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = process.env.FOUNDRY_DB_PATH || './foundry.db';
  db = new Database(dbPath);

  // Enable foreign key constraints
  db.pragma('foreign_keys = ON');

  // Create tables
  createTables(db);

  // Normalize any legacy doc_path values
  migrateDocPaths(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function createTables(database: Database.Database): void {
  // Create reviews table first (referenced by annotations)
  database.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      doc_path TEXT NOT NULL,
      user_id TEXT DEFAULT "anonymous",
      status TEXT NOT NULL DEFAULT "draft",
      submitted_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Create docs_meta table for native content storage
  database.exec(`
    CREATE TABLE IF NOT EXISTS docs_meta (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      access TEXT DEFAULT 'public',
      content_hash TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      modified_by TEXT DEFAULT 'system',
      created_at TEXT NOT NULL
    );
  `);

  // Create annotations table
  database.exec(`
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      doc_path TEXT NOT NULL,
      heading_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      quoted_text TEXT,
      content TEXT NOT NULL,
      parent_id TEXT,
      review_id TEXT,
      user_id TEXT DEFAULT "anonymous",
      author_type TEXT NOT NULL DEFAULT "human",
      status TEXT NOT NULL DEFAULT "draft",
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES annotations(id),
      FOREIGN KEY (review_id) REFERENCES reviews(id)
    );
  `);

  // OAuth / auth tables (E12: MCP Authorization)
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      github_login TEXT NOT NULL UNIQUE,
      github_id INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_clients (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      client_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      pkce_challenge TEXT NOT NULL,
      pkce_method TEXT NOT NULL DEFAULT 'S256',
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      access_token_hash TEXT PRIMARY KEY,
      refresh_token_hash TEXT UNIQUE,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      refresh_expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_tokens(expires_at);
  `);
}