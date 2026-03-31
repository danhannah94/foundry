import Database from 'better-sqlite3';
import { join } from 'path';

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
      user_id TEXT DEFAULT "dan",
      status TEXT NOT NULL DEFAULT "draft",
      submitted_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      user_id TEXT DEFAULT "dan",
      author_type TEXT NOT NULL DEFAULT "human",
      status TEXT NOT NULL DEFAULT "draft",
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES annotations(id),
      FOREIGN KEY (review_id) REFERENCES reviews(id)
    );
  `);
}