/**
 * Express CRUD routes for Foundry documents.
 *
 * GET    /api/docs/:path(*)/sections/:heading(*) — Get section by heading path
 * POST   /api/docs                              — Create new document
 * PUT    /api/docs/:path(*)/sections/:heading(*) — Update section body
 * POST   /api/docs/:path(*)/sections/move        — Move section to new position
 * POST   /api/docs/:path(*)/sections             — Insert new section
 * DELETE /api/docs/:path(*)/sections/:heading(*) — Delete section
 * DELETE /api/docs/:path(*)                      — Hard-delete document
 *
 * Writes require auth (requireAuth middleware); read is intentionally
 * open. Route bodies are thin — all business logic lives in
 * `services/docs.ts` so MCP tool handlers (S10b) can share it without
 * the HTTP loopback.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as docsService from '../services/docs.js';
import * as pagesService from '../services/pages.js';
import { ServiceError } from '../services/errors.js';

function sendError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof ServiceError) {
    const body: Record<string, unknown> = { error: err.message };
    if (err.extra) Object.assign(body, err.extra);
    res.status(err.status).json(body);
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[doc-crud] ${fallback}:`, err);
  res.status(500).json({ error: fallback, message: msg });
}

export function createDocCrudRouter(): Router {
  const router = Router();

  // GET /api/docs/:path/sections/:heading — get section
  router.get('/docs/:path(*)/sections/:heading(*)', async (req: Request, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await pagesService.getSection(ctx, {
        path: req.params.path,
        headingPath: decodeURIComponent(req.params.heading),
      });
      res.json(result);
    } catch (err) {
      sendError(res, err, 'Failed to get section');
    }
  });

  // POST /api/docs — create document
  router.post('/docs', requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await docsService.createDoc(ctx, req.body);
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err, 'Failed to create document');
    }
  });

  // PUT /api/docs/:path/sections/:heading — update section
  router.put('/docs/:path(*)/sections/:heading(*)', requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await docsService.updateSection(ctx, {
        path: req.params.path,
        headingPath: req.params.heading,
        content: req.body.content,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err, 'Failed to update section');
    }
  });

  // POST /api/docs/:path/sections/move — move section
  router.post('/docs/:path(*)/sections/move', requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await docsService.moveSection(ctx, {
        path: req.params.path,
        heading: req.body.heading,
        after_heading: req.body.after_heading,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err, 'Failed to move section');
    }
  });

  // POST /api/docs/:path/sections — insert section
  router.post('/docs/:path(*)/sections', requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await docsService.insertSection(ctx, {
        path: req.params.path,
        after_heading: req.body.after_heading,
        heading: req.body.heading,
        level: req.body.level,
        content: req.body.content,
      });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err, 'Failed to insert section');
    }
  });

  // DELETE /api/docs/:path/sections/:heading — delete section
  router.delete('/docs/:path(*)/sections/:heading(*)', requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await docsService.deleteSection(ctx, {
        path: req.params.path,
        headingPath: req.params.heading,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err, 'Failed to delete section');
    }
  });

  // DELETE /api/docs/:path — hard-delete document
  router.delete('/docs/:path(*)', requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await docsService.deleteDoc(ctx, { path: req.params.path });
      res.json(result);
    } catch (err) {
      sendError(res, err, 'Failed to delete document');
    }
  });

  return router;
}
