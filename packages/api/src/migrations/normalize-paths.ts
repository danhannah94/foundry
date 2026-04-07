import Database from 'better-sqlite3';
import { normalizeDocPath } from '../utils/normalize-doc-path.js';

export function migrateDocPaths(db: Database.Database): void {
  // Get all unique doc_paths from annotations
  const annotationPaths = db.prepare('SELECT DISTINCT doc_path FROM annotations').all() as {doc_path: string}[];

  // Get all unique doc_paths from reviews
  const reviewPaths = db.prepare('SELECT DISTINCT doc_path FROM reviews').all() as {doc_path: string}[];

  const updateAnnotations = db.prepare('UPDATE annotations SET doc_path = ? WHERE doc_path = ?');
  const updateReviews = db.prepare('UPDATE reviews SET doc_path = ? WHERE doc_path = ?');

  // Run in a single transaction (atomic)
  const migrate = db.transaction(() => {
    for (const row of annotationPaths) {
      const normalized = normalizeDocPath(row.doc_path);
      if (normalized !== row.doc_path) {
        updateAnnotations.run(normalized, row.doc_path);
      }
    }
    for (const row of reviewPaths) {
      const normalized = normalizeDocPath(row.doc_path);
      if (normalized !== row.doc_path) {
        updateReviews.run(normalized, row.doc_path);
      }
    }
  });

  migrate();
}
