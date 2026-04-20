import { Router, Request, Response, NextFunction } from 'express';
import { getDocsPath } from '../config.js';
import { generateNavPages } from '../utils/nav-generator.js';
import { requireAuth, requireScope } from '../middleware/auth.js';

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
    // If requireAuth already sent a 401 response, bail — no further chain.
    if (res.headersSent) return;
    requireScope('docs:read:private')(req, res, next);
  });
}

export function createPagesRouter(): Router {
  const router = Router();

  router.get('/pages', authIfIncludePrivate, (req: Request, res: Response) => {
    try {
      const docsPath = getDocsPath();
      const allPages = generateNavPages(docsPath);

      const includePrivate = req.query.include_private === 'true';

      const pages = includePrivate
        ? allPages
        : allPages.filter(p => p.access === 'public');

      res.json(pages);
    } catch (error) {
      console.error('Error listing pages:', error);
      res.status(500).json({ error: 'Failed to list pages' });
    }
  });

  return router;
}
