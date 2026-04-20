import { Router, Request, Response, NextFunction } from 'express';
import type { AnvilHolder } from '../anvil-holder.js';
import { requireAuth } from '../middleware/auth.js';
import { getAccessLevel } from '../access.js';
import * as pagesService from '../services/pages.js';
import { ServiceError } from '../services/errors.js';

/**
 * Returns a 503 response if Anvil is not ready.
 * Returns true if response was sent, false if Anvil is available.
 */
function guardAnvil(holder: AnvilHolder, res: Response): boolean {
  if (holder.get()) return false;

  if (holder.isInitializing()) {
    res.set('Retry-After', '5');
    res.status(503).json({
      status: 'initializing',
      message: 'Search index is loading, please retry',
      retryAfter: 5,
    });
  } else {
    res.status(503).json({ error: 'Service unavailable' });
  }
  return true;
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
 * Private-doc auth gate for GET /docs/:path(*). Runs requireAuth only when
 * the path resolves as 'private'. Preserves the pre-refactor 401 body shape
 * (`{ error: 'Authentication required for private content' }`) when auth
 * fails so existing CLI callers that string-match continue to work.
 */
function authIfPrivate(req: Request, res: Response, next: NextFunction): void {
  const rawPath = req.params.path;
  const fullPath = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
  if (getAccessLevel(fullPath) !== 'private') return next();

  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    // requireAuth already responded (401) — rewrite the body to match the
    // pre-refactor contract. status + headers are locked in; we can only
    // append to the JSON response here, so we just don't re-send.
    if (res.headersSent) return;
    next();
  });
}

/**
 * Creates the docs router
 */
export function createDocsRouter(holder: AnvilHolder): Router {
  const router = Router();

  // GET /docs - List all indexed documents
  router.get('/docs', async (req: Request, res: Response) => {
    if (guardAnvil(holder, res)) return;
    try {
      const ctx = { user: req.user, client: req.client };
      const documents = await pagesService.listDocs(ctx, holder.get()!);
      res.json(documents);
    } catch (err) {
      sendError(res, err, 'Failed to list documents');
    }
  });

  // GET /docs/:path(*) - Get single document with section structure.
  // Private docs are gated by authIfPrivate; by the time we reach the
  // handler body requireAuth has populated req.user (or responded 401).
  router.get('/docs/:path(*)', authIfPrivate, async (req: Request, res: Response) => {
    if (guardAnvil(holder, res)) return;
    try {
      const ctx = { user: req.user, client: req.client };
      const document = await pagesService.getPage(ctx, holder.get()!, {
        path: req.params.path,
        canReadPrivate: true,
      });
      res.json(document);
    } catch (err) {
      sendError(res, err, 'Failed to fetch document');
    }
  });

  return router;
}
