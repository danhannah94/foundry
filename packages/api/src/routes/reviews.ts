import { Router, Request, Response } from 'express';
import {
  Review,
  CreateReviewBody,
} from '../types/annotations.js';
import * as reviewsService from '../services/reviews.js';
import { ServiceError } from '../services/errors.js';

interface ReviewListQuery {
  doc_path: string;
  status?: string;
}

function sendError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof ServiceError) {
    const body: Record<string, unknown> = { error: err.message };
    if (err.extra) Object.assign(body, err.extra);
    res.status(err.status).json(body);
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
}

/**
 * Creates the reviews router
 */
export function createReviewsRouter(): Router {
  const router = Router();

  // GET /reviews - List reviews for a document
  router.get('/reviews', async (req: Request<{}, Review[], {}, ReviewListQuery>, res: Response<Review[]>) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const rows = await reviewsService.list(ctx, req.query);
      res.json(rows);
    } catch (err) {
      sendError(res, err, 'Failed to list reviews');
    }
  });

  // GET /reviews/:id - Get single review with its annotations
  router.get('/reviews/:id', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await reviewsService.get(ctx, { id: req.params.id });
      res.json(result);
    } catch (err) {
      sendError(res, err, 'Failed to get review');
    }
  });

  // POST /reviews - Create new review
  router.post('/reviews', async (req: Request<{}, Review, CreateReviewBody>, res: Response<Review>) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const review = await reviewsService.create(ctx, { doc_path: req.body.doc_path });
      res.status(201).json(review);
    } catch (err) {
      sendError(res, err, 'Failed to create review');
    }
  });

  // PATCH /reviews/:id - Update review
  router.patch('/reviews/:id', async (req: Request<{ id: string }, Review, Partial<Pick<Review, 'status' | 'submitted_at' | 'completed_at'>>>, res: Response<Review>) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const updated = await reviewsService.edit(ctx, { id: req.params.id, ...req.body });
      res.json(updated);
    } catch (err) {
      sendError(res, err, 'Failed to update review');
    }
  });

  return router;
}
