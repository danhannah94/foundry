import { Router, Request, Response } from 'express';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '../db.js';
import {
  Review,
  CreateReviewBody
} from '../types/annotations.js';

interface ReviewListQuery {
  doc_path: string;
}

/**
 * Creates the reviews router
 */
export function createReviewsRouter(): Router {
  const router = Router();

  // GET /reviews - List reviews for a document
  router.get('/reviews', async (req: Request<{}, Review[], {}, ReviewListQuery>, res: Response<Review[]>) => {
    try {
      const { doc_path } = req.query;

      if (!doc_path) {
        return res.status(400).json({
          error: 'doc_path query parameter is required',
        } as any);
      }

      const db = getDb();

      const stmt = db.prepare('SELECT * FROM reviews WHERE doc_path = ? ORDER BY created_at DESC');
      const rows = stmt.all(doc_path) as Review[];

      res.json(rows);
    } catch (error) {
      console.error('Error listing reviews:', error);
      res.status(500).json({
        error: 'Failed to list reviews',
      } as any);
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

      const db = getDb();
      const id = createId();
      const now = new Date().toISOString();

      const review: Review = {
        id,
        doc_path,
        user_id: 'dan',
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

  return router;
}