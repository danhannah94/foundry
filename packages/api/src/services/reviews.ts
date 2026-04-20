/**
 * Reviews service — transport-agnostic business logic for reviews.
 *
 * Identity propagation: user_id on `create` comes from ctx.user; any
 * user_id in user-supplied params is ignored. Dev-mode passthrough
 * (no ctx.user) falls back to 'anonymous'.
 *
 * `submit` composes list-annotations + patch-annotation + patch-review
 * into the aggregate review-submit flow that the MCP `submit_review`
 * tool needs today (currently implemented as three HTTP calls in
 * http-client.ts — S10b will replace that with this service).
 */

import { createId } from '@paralleldrive/cuid2';
import { getDb } from '../db.js';
import { normalizeDocPath } from '../utils/normalize-doc-path.js';
import type {
  Annotation,
  Review,
  ReviewStatus,
} from '../types/annotations.js';
import type { AuthContext } from './context.js';
import { NotFoundError, ValidationError } from './errors.js';
import * as annotationsService from './annotations.js';

// ─── list ─────────────────────────────────────────────────────────────────────

export interface ListReviewsParams {
  doc_path: string;
  status?: string;
}

export async function list(
  _ctx: AuthContext,
  params: ListReviewsParams,
): Promise<Review[]> {
  const { doc_path, status } = params;

  if (!doc_path) {
    throw new ValidationError('doc_path query parameter is required');
  }

  const db = getDb();
  const normalized = normalizeDocPath(doc_path);
  let query = `SELECT * FROM reviews WHERE doc_path = ?`;
  const queryParams: unknown[] = [normalized];

  if (status) {
    query += ' AND status = ?';
    queryParams.push(status);
  }

  query += ' ORDER BY created_at DESC';

  return db.prepare(query).all(...queryParams) as Review[];
}

// ─── get ──────────────────────────────────────────────────────────────────────

export interface GetReviewResult {
  review: Review;
  annotations: Annotation[];
}

export async function get(
  _ctx: AuthContext,
  params: { id: string },
): Promise<GetReviewResult> {
  const { id } = params;
  const db = getDb();

  const review = db
    .prepare('SELECT * FROM reviews WHERE id = ?')
    .get(id) as Review | undefined;

  if (!review) {
    throw new NotFoundError('Review not found');
  }

  const annotations = db
    .prepare('SELECT * FROM annotations WHERE review_id = ? ORDER BY created_at ASC')
    .all(id) as Annotation[];

  return { review, annotations };
}

// ─── create ───────────────────────────────────────────────────────────────────

export async function create(
  ctx: AuthContext,
  params: { doc_path: string },
): Promise<Review> {
  const { doc_path } = params;

  if (!doc_path) {
    throw new ValidationError('doc_path is required');
  }

  // Identity is server-authoritative.
  const effectiveUserId = ctx.user?.id ?? 'anonymous';

  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  const normalizedDocPath = normalizeDocPath(doc_path);

  const review: Review = {
    id,
    doc_path: normalizedDocPath,
    user_id: effectiveUserId,
    status: 'draft',
    submitted_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO reviews (
      id, doc_path, user_id, status, submitted_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    review.id,
    review.doc_path,
    review.user_id,
    review.status,
    review.submitted_at,
    review.completed_at,
    review.created_at,
    review.updated_at,
  );

  return review;
}

// ─── edit / patch ─────────────────────────────────────────────────────────────

export interface EditReviewParams {
  id: string;
  status?: ReviewStatus;
  submitted_at?: string | null;
  completed_at?: string | null;
}

export async function edit(
  _ctx: AuthContext,
  params: EditReviewParams,
): Promise<Review> {
  const { id, status, submitted_at, completed_at } = params;

  if (!status && !submitted_at && !completed_at) {
    throw new ValidationError('status, submitted_at, or completed_at must be provided');
  }

  const db = getDb();
  const existingStmt = db.prepare('SELECT * FROM reviews WHERE id = ?');
  const existing = existingStmt.get(id) as Review | undefined;

  if (!existing) {
    throw new NotFoundError('Review not found');
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const queryParams: unknown[] = [];

  if (status !== undefined) {
    updates.push('status = ?');
    queryParams.push(status);
  }
  if (submitted_at !== undefined) {
    updates.push('submitted_at = ?');
    queryParams.push(submitted_at);
  }
  if (completed_at !== undefined) {
    updates.push('completed_at = ?');
    queryParams.push(completed_at);
  }

  updates.push('updated_at = ?');
  queryParams.push(now);
  queryParams.push(id);

  db.prepare(`UPDATE reviews SET ${updates.join(', ')} WHERE id = ?`).run(...queryParams);

  return existingStmt.get(id) as Review;
}

// ─── submit ───────────────────────────────────────────────────────────────────

export interface SubmitReviewParams {
  doc_path: string;
  annotation_ids?: string[];
}

export interface SubmitReviewResult {
  status: 'review_submitted';
  review_id: string;
  doc_path: string;
  submitted_at: string;
  comment_count: number;
  comments: Array<{
    id: string;
    heading_path: string;
    quoted_text: string | null;
    content: string;
  }>;
}

/**
 * Aggregate submit-review flow used by the MCP `submit_review` tool.
 * Composes: create review → patch each annotation with review_id +
 * status='submitted' → patch review to status='submitted'.
 *
 * When annotation_ids is omitted, picks up all draft + submitted
 * annotations on the doc.
 */
export async function submit(
  ctx: AuthContext,
  params: SubmitReviewParams,
): Promise<SubmitReviewResult> {
  const { doc_path, annotation_ids } = params;

  const review = await create(ctx, { doc_path });

  let annotations: Annotation[];
  if (annotation_ids && annotation_ids.length > 0) {
    const all = await annotationsService.list(ctx, { doc_path });
    annotations = all.filter(a => annotation_ids.includes(a.id));
  } else {
    const drafts = await annotationsService.list(ctx, { doc_path, status: 'draft' });
    const submitted = await annotationsService.list(ctx, { doc_path, status: 'submitted' });
    annotations = [...drafts, ...submitted];
  }

  const now = new Date().toISOString();

  for (const ann of annotations) {
    await annotationsService.edit(ctx, {
      id: ann.id,
      review_id: review.id,
      status: 'submitted',
    });
  }

  await edit(ctx, {
    id: review.id,
    status: 'submitted',
    submitted_at: now,
  });

  return {
    status: 'review_submitted',
    review_id: review.id,
    doc_path,
    submitted_at: now,
    comment_count: annotations.length,
    comments: annotations.map(a => ({
      id: a.id,
      heading_path: a.heading_path,
      quoted_text: a.quoted_text,
      content: a.content,
    })),
  };
}
