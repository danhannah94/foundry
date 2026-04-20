/**
 * Annotations service — transport-agnostic business logic for annotations.
 *
 * All functions take an AuthContext as the first argument. Identity is
 * derived server-side from `ctx.user` / `ctx.client`: any user_id or
 * author_type in user-supplied params is ignored (same behavior the
 * HTTP handler exhibits today).
 *
 * Error handling: functions throw ValidationError / NotFoundError from
 * services/errors.ts for business-logic failures. Transport layers
 * catch and map to their protocol's response shape.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '../db.js';
import { getDocsPath } from '../config.js';
import { normalizeDocPath } from '../utils/normalize-doc-path.js';
import {
  Annotation,
  AnnotationStatus,
  AuthorType,
} from '../types/annotations.js';
import type { AuthContext } from './context.js';
import { NotFoundError, ValidationError } from './errors.js';

// ─── list ─────────────────────────────────────────────────────────────────────

export interface ListAnnotationsParams {
  doc_path: string;
  section?: string;
  status?: AnnotationStatus;
  review_id?: string;
}

/**
 * List annotations for a document, optionally filtered by section, status,
 * or review_id.
 */
export async function list(
  _ctx: AuthContext,
  params: ListAnnotationsParams,
): Promise<Annotation[]> {
  const { doc_path, section, status, review_id } = params;

  if (!doc_path) {
    throw new ValidationError('doc_path query parameter is required');
  }

  const db = getDb();
  const normalized = normalizeDocPath(doc_path);
  let query = `SELECT * FROM annotations WHERE doc_path = ?`;
  const queryParams: unknown[] = [normalized];

  if (section) {
    query += ' AND heading_path LIKE ?';
    queryParams.push(`%${section}%`);
  }

  if (status) {
    query += ' AND status = ?';
    queryParams.push(status);
  }

  if (review_id) {
    query += ' AND review_id = ?';
    queryParams.push(review_id);
  }

  query += ' ORDER BY created_at DESC';

  const stmt = db.prepare(query);
  return stmt.all(...queryParams) as Annotation[];
}

// ─── get ──────────────────────────────────────────────────────────────────────

export interface GetAnnotationResult {
  annotation: Annotation;
  replies: Annotation[];
}

export async function get(
  _ctx: AuthContext,
  params: { id: string },
): Promise<GetAnnotationResult> {
  const { id } = params;
  const db = getDb();

  const annotation = db
    .prepare('SELECT * FROM annotations WHERE id = ?')
    .get(id) as Annotation | undefined;

  if (!annotation) {
    throw new NotFoundError('Annotation not found');
  }

  const replies = db
    .prepare('SELECT * FROM annotations WHERE parent_id = ? ORDER BY created_at ASC')
    .all(id) as Annotation[];

  return { annotation, replies };
}

// ─── create ───────────────────────────────────────────────────────────────────

export interface CreateAnnotationParams {
  doc_path: string;
  heading_path: string;
  content_hash?: string;
  quoted_text?: string;
  content: string;
  parent_id?: string;
  review_id?: string;
  status?: AnnotationStatus;
}

/**
 * Create an annotation. Identity (user_id, author_type) is derived from
 * ctx — any user_id/author_type on `params` is silently ignored.
 *
 * Returns { annotation, duplicate } — when `duplicate` is true, the
 * caller hit the 30-second dedupe window and we returned the existing
 * row without creating a new one. The HTTP layer maps that to a 200
 * instead of 201 (preserves pre-refactor behavior).
 */
export async function create(
  ctx: AuthContext,
  params: CreateAnnotationParams,
): Promise<{ annotation: Annotation; duplicate: boolean }> {
  const {
    doc_path,
    heading_path,
    content_hash,
    quoted_text,
    content,
    parent_id,
    review_id,
    status: bodyStatus,
  } = params;

  // Identity is server-authoritative. Interactive clients → 'human';
  // everything else (autonomous or missing) → 'ai'. Dev-mode passthrough
  // (no ctx.user) falls back to 'anonymous' to document the write.
  const effectiveUserId = ctx.user?.id ?? 'anonymous';
  const effectiveAuthorType: AuthorType =
    ctx.client?.client_type === 'interactive' ? 'human' : 'ai';

  if (!doc_path || !heading_path || !content) {
    throw new ValidationError('doc_path, heading_path, and content are required');
  }

  const VALID_STATUSES: AnnotationStatus[] = [
    'draft',
    'submitted',
    'replied',
    'resolved',
    'orphaned',
  ];
  if (bodyStatus !== undefined && !VALID_STATUSES.includes(bodyStatus)) {
    throw new ValidationError(
      `Invalid status "${bodyStatus}". Must be one of: ${VALID_STATUSES.join(', ')}`,
    );
  }

  const normalizedPath = normalizeDocPath(doc_path);
  const contentDir = getDocsPath();
  const filePath = join(contentDir, `${normalizedPath}.md`);
  if (!existsSync(filePath)) {
    throw new NotFoundError(
      `Document not found: "${normalizedPath}". Cannot create annotation on a non-existent document.`,
    );
  }

  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();

  // BUG-6: If replying to a parent, inherit its review_id when not explicitly provided
  let effectiveReviewId = review_id;
  if (parent_id && !review_id) {
    const parent = db
      .prepare('SELECT review_id FROM annotations WHERE id = ?')
      .get(parent_id) as { review_id: string | null } | undefined;
    if (parent?.review_id) {
      effectiveReviewId = parent.review_id;
    }
  }

  // Dedup: same review_id + content + quoted_text within 30s → return the existing row.
  if (review_id) {
    const recentDuplicate = db
      .prepare(
        `SELECT id FROM annotations
         WHERE review_id = ? AND content = ? AND quoted_text IS ?
         AND created_at > datetime('now', '-30 seconds')`,
      )
      .get(review_id, content, quoted_text || null);

    if (recentDuplicate) {
      const existing = db
        .prepare('SELECT * FROM annotations WHERE id = ?')
        .get((recentDuplicate as { id: string }).id) as Annotation;
      return { annotation: existing, duplicate: true };
    }
  }

  // Replies + AI-authored annotations auto-submit; top-level human starts as draft.
  const effectiveStatus: AnnotationStatus =
    bodyStatus !== undefined
      ? bodyStatus
      : parent_id || effectiveAuthorType === 'ai'
      ? 'submitted'
      : 'draft';

  const annotation: Annotation = {
    id,
    doc_path: normalizedPath,
    heading_path,
    content_hash: content_hash || '',
    quoted_text: quoted_text || null,
    content,
    parent_id: parent_id || null,
    review_id: effectiveReviewId || null,
    user_id: effectiveUserId,
    author_type: effectiveAuthorType,
    status: effectiveStatus,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO annotations (
      id, doc_path, heading_path, content_hash, quoted_text, content,
      parent_id, review_id, user_id, author_type, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    annotation.id,
    annotation.doc_path,
    annotation.heading_path,
    annotation.content_hash,
    annotation.quoted_text,
    annotation.content,
    annotation.parent_id,
    annotation.review_id,
    annotation.user_id,
    annotation.author_type,
    annotation.status,
    annotation.created_at,
    annotation.updated_at,
  );

  return { annotation, duplicate: false };
}

// ─── edit / patch ─────────────────────────────────────────────────────────────

export interface EditAnnotationParams {
  id: string;
  status?: AnnotationStatus;
  content?: string;
  review_id?: string | null;
}

/**
 * Generic update: any combination of status/content/review_id.
 * `resolve` / `reopen` are convenience wrappers over this.
 */
export async function edit(
  _ctx: AuthContext,
  params: EditAnnotationParams,
): Promise<Annotation> {
  const { id, status, content, review_id } = params;

  if (!status && !content && review_id === undefined) {
    throw new ValidationError('status, content, or review_id must be provided');
  }

  const db = getDb();
  const existingStmt = db.prepare('SELECT * FROM annotations WHERE id = ?');
  const existing = existingStmt.get(id) as Annotation | undefined;

  if (!existing) {
    throw new NotFoundError('Annotation not found');
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const queryParams: unknown[] = [];

  if (status !== undefined) {
    updates.push('status = ?');
    queryParams.push(status);
  }
  if (content !== undefined) {
    updates.push('content = ?');
    queryParams.push(content);
  }
  if (review_id !== undefined) {
    updates.push('review_id = ?');
    queryParams.push(review_id);
  }

  updates.push('updated_at = ?');
  queryParams.push(now);
  queryParams.push(id);

  db.prepare(`UPDATE annotations SET ${updates.join(', ')} WHERE id = ?`).run(...queryParams);

  return existingStmt.get(id) as Annotation;
}

// ─── resolve / reopen convenience wrappers ────────────────────────────────────

export async function resolve(
  ctx: AuthContext,
  params: { id: string },
): Promise<Annotation> {
  return edit(ctx, { id: params.id, status: 'resolved' });
}

export async function reopen(
  ctx: AuthContext,
  params: { id: string },
): Promise<Annotation> {
  return edit(ctx, { id: params.id, status: 'draft' });
}

// ─── delete ───────────────────────────────────────────────────────────────────

export async function del(
  _ctx: AuthContext,
  params: { id: string },
): Promise<void> {
  const { id } = params;
  const db = getDb();

  const existing = db
    .prepare('SELECT * FROM annotations WHERE id = ?')
    .get(id) as Annotation | undefined;

  if (!existing) {
    throw new NotFoundError('Annotation not found');
  }

  // Cascade delete child replies first
  db.prepare('DELETE FROM annotations WHERE parent_id = ?').run(id);
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id);

  // Orphan-review cleanup — if deleting the last annotation on a review, nuke the review.
  if (existing.review_id) {
    const remaining = db
      .prepare('SELECT COUNT(*) as count FROM annotations WHERE review_id = ?')
      .get(existing.review_id) as { count: number };

    if (remaining.count === 0) {
      db.prepare('DELETE FROM reviews WHERE id = ?').run(existing.review_id);
    }
  }
}
