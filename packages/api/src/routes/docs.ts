import { Router, Request, Response, NextFunction } from 'express';
import type { AnvilHolder } from '../anvil-holder.js';
import { requireAuth, requireScope } from '../middleware/auth.js';
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
 * Private-doc auth+scope gate for GET /docs/:path(*). Runs only when the
 * path resolves as 'private': first requireAuth (401 on no/invalid token),
 * then requireScope('docs:read:private') (403 if the authed user lacks
 * the scope). Public-doc paths fall through unchanged. Closes the same
 * #99-class gap S9 fixed for /api/search + /api/pages — any Bearer token
 * used to unlock private doc bodies here regardless of scope.
 */
function authIfPrivate(req: Request, res: Response, next: NextFunction): void {
  const rawPath = req.params.path;
  const fullPath = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
  if (getAccessLevel(fullPath) !== 'private') return next();

  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    // requireAuth already responded (401) — don't double-send.
    if (res.headersSent) return;
    // Authenticated; now check the user holds docs:read:private.
    requireScope('docs:read:private')(req, res, next);
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
