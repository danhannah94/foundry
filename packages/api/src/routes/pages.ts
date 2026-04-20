import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireScope } from '../middleware/auth.js';
import * as pagesService from '../services/pages.js';

/**
 * Conditional auth gate for /api/pages.
 *
 * When `?include_private=true`, the caller is explicitly asking for
 * private docs and must present a Bearer token carrying `docs:read:private`.
 * Without the flag, anonymous callers can list public pages (used by the
 * browser's site-wide nav).
 *
 * Implementation uses nested middleware invocation so that errors from
 * requireAuth (401 WWW-Authenticate) and requireScope (403 insufficient_scope)
 * surface intact without tripping the global error handler.
 */
function authIfIncludePrivate(req: Request, res: Response, next: NextFunction): void {
  if (req.query.include_private !== 'true') {
    return next();
  }
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (res.headersSent) return;
    requireScope('docs:read:private')(req, res, next);
  });
}

export function createPagesRouter(): Router {
  const router = Router();

  router.get('/pages', authIfIncludePrivate, async (req: Request, res: Response) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const includePrivate = req.query.include_private === 'true';
      const pages = await pagesService.listPages(ctx, { includePrivate });
      res.json(pages);
    } catch (err) {
      console.error('Error listing pages:', err);
      res.status(500).json({ error: 'Failed to list pages' });
    }
  });

  return router;
}
