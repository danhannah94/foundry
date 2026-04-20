import { Router, Request, Response } from 'express';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '../db.js';
import { normalizeDocPath } from '../utils/normalize-doc-path.js';
import {
  Annotation,
  Review,
  CreateReviewBody
} from '../types/annotations.js';

interface ReviewListQuery {
  doc_path: string;
  status?: string;
}

/**
 * Creates the reviews router
 */
export function createReviewsRouter(): Router {
  const router = Router();

  // GET /reviews - List reviews for a document
  router.get('/reviews', async (req: Request<{}, Review[], {}, ReviewListQuery>, res: Response<Review[]>) => {
    try {
      const { doc_path, status } = req.query;

      if (!doc_path) {
        return res.status(400).json({
          error: 'doc_path query parameter is required',
        } as any);
      }

      const db = getDb();

      const normalized = normalizeDocPath(doc_path);
      let query = `SELECT * FROM reviews WHERE doc_path = ?`;
      const params: any[] = [normalized];

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      query += ' ORDER BY created_at DESC';

      const stmt = db.prepare(query);
      const rows = stmt.all(...params) as Review[];

      res.json(rows);
    } catch (error) {
      console.error('Error listing reviews:', error);
      res.status(500).json({
        error: 'Failed to list reviews',
      } as any);
    }
  });

  // GET /reviews/:id - Get single review with its annotations
  router.get('/reviews/:id', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDb();

      const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Review | undefined;

      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }

      const annotations = db.prepare(
        'SELECT * FROM annotations WHERE review_id = ? ORDER BY created_at ASC'
      ).all(id) as Annotation[];

      res.json({ review, annotations });
    } catch (error) {
      console.error('Error getting review:', error);
      res.status(500).json({ error: 'Failed to get review' });
    }
  });

  // POST /reviews - Create new review
  router.post('/reviews', async (req: Request<{}, Review, CreateReviewBody>, res: Response<Review>) => {
    try {
      const { doc_path } = req.body;

      // Validate required fields
      if (!doc_path) {
        return res.status(400).json({
          error: 'doc_path is required',
        } as any);
      }

      // Identity is server-authoritative — derive user_id from the
      // authenticated caller (req.user, populated by requireAuth).
      // Any user_id sent in the request body is silently ignored.
      // Dev-mode passthrough (req.user undefined when auth is fully
      // unconfigured) falls back to 'anonymous' to document the
      // unauthenticated write.
      const effectiveUserId = req.user?.id ?? 'anonymous';

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

      const stmt = db.prepare(`
        INSERT INTO reviews (
          id, doc_path, user_id, status, submitted_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        review.id,
        review.doc_path,
        review.user_id,
        review.status,
        review.submitted_at,
        review.completed_at,
        review.created_at,
        review.updated_at
      );

      res.status(201).json(review);
    } catch (error) {
      console.error('Error creating review:', error);
      res.status(500).json({
        error: 'Failed to create review',
      } as any);
    }
  });

  // PATCH /reviews/:id - Update review
  router.patch('/reviews/:id', async (req: Request<{ id: string }, Review, Partial<Pick<Review, 'status' | 'submitted_at' | 'completed_at'>>>, res: Response<Review>) => {
    try {
      const { id } = req.params;
      const { status, submitted_at, completed_at } = req.body;

      if (!status && !submitted_at && !completed_at) {
        return res.status(400).json({
          error: 'status, submitted_at, or completed_at must be provided',
        } as any);
      }

      const db = getDb();

      // First check if review exists
      const existingStmt = db.prepare('SELECT * FROM reviews WHERE id = ?');
      const existing = existingStmt.get(id) as Review | undefined;

      if (!existing) {
        return res.status(404).json({
          error: 'Review not found',
        } as any);
      }

      const now = new Date().toISOString();
      const updates: string[] = [];
      const params: any[] = [];

      if (status !== undefined) {
        updates.push('status = ?');
        params.push(status);
      }

      if (submitted_at !== undefined) {
        updates.push('submitted_at = ?');
        params.push(submitted_at);
      }

      if (completed_at !== undefined) {
        updates.push('completed_at = ?');
        params.push(completed_at);
      }

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      const updateStmt = db.prepare(`
        UPDATE reviews
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      updateStmt.run(...params);

      // Fetch updated review
      const updatedReview = existingStmt.get(id) as Review;
      res.json(updatedReview);
    } catch (error) {
      console.error('Error updating review:', error);
      res.status(500).json({
        error: 'Failed to update review',
      } as any);
    }
  });

  return router;
}