import { Router, Request, Response } from 'express';
import {
  Annotation,
  CreateAnnotationBody,
  AnnotationStatus,
} from '../types/annotations.js';
import * as annotationsService from '../services/annotations.js';
import { ServiceError } from '../services/errors.js';

interface AnnotationListQuery {
  doc_path: string;
  section?: string;
  status?: AnnotationStatus;
  review_id?: string;
}

/**
 * Shared handler error surface: maps ServiceError.status → HTTP + body,
 * otherwise logs and 500s. Preserves existing HTTP contract shape
 * (plain `{ error: string }` body; extra fields spread in when present).
 */
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
 * Creates the annotations router
 */
export function createAnnotationsRouter(): Router {
  const router = Router();

  // GET /annotations - List annotations with filters
  router.get('/annotations', async (req: Request<{}, Annotation[], {}, AnnotationListQuery>, res: Response<Annotation[]>) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const rows = await annotationsService.list(ctx, req.query);
      res.json(rows);
    } catch (err) {
      sendError(res, err, 'Failed to list annotations');
    }
  });

  // GET /annotations/:id - Get single annotation with reply thread
  router.get('/annotations/:id', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await annotationsService.get(ctx, { id: req.params.id });
      res.json(result);
    } catch (err) {
      sendError(res, err, 'Failed to get annotation');
    }
  });

  // POST /annotations - Create new annotation
  router.post('/annotations', async (req: Request<{}, Annotation, CreateAnnotationBody>, res: Response<Annotation>) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const { annotation, duplicate } = await annotationsService.create(ctx, req.body);
      res.status(duplicate ? 200 : 201).json(annotation);
    } catch (err) {
      sendError(res, err, 'Failed to create annotation');
    }
  });

  // PATCH /annotations/:id - Update annotation
  router.patch('/annotations/:id', async (req: Request<{ id: string }, Annotation, Partial<Pick<Annotation, 'status' | 'content' | 'review_id'>>>, res: Response<Annotation>) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const updated = await annotationsService.edit(ctx, { id: req.params.id, ...req.body });
      res.json(updated);
    } catch (err) {
      sendError(res, err, 'Failed to update annotation');
    }
  });

  // DELETE /annotations/:id - Delete annotation (cascade children + orphan review cleanup)
  router.delete('/annotations/:id', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      await annotationsService.del(ctx, { id: req.params.id });
      res.status(204).send();
    } catch (err) {
      sendError(res, err, 'Failed to delete annotation');
    }
  });

  return router;
}
