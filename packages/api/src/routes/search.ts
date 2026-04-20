import { Router, Request, Response } from 'express';
import type { AnvilHolder } from '../anvil-holder.js';
import { softAuth } from '../middleware/auth.js';
import * as searchService from '../services/search.js';
import { ServiceError } from '../services/errors.js';

/**
 * Creates the search router.
 *
 * NOTE: /api/search is the ONE auth-optional route in Foundry. Browsers
 * hit it anonymously (no Bearer header) for the site-wide search UI —
 * that's a product requirement. All other routes either require auth
 * outright (requireAuth) or don't surface access-gated data.
 *
 * Because of this, we use `softAuth` instead of `requireAuth`: it
 * populates req.user when a valid Bearer token is presented, but never
 * 401s on missing/invalid tokens. Private-doc filtering lives in the
 * service layer, which reads `ctx.user?.scopes?.includes('docs:read:private')`.
 */
export function createSearchRouter(holder: AnvilHolder): Router {
  const router = Router();

  router.post('/search', softAuth, async (req: Request, res: Response) => {
    const anvil = holder.get();
    if (!anvil) {
      if (holder.isInitializing()) {
        res.set('Retry-After', '5');
        return res.status(503).json({
          status: 'initializing',
          message: 'Search index is loading, please retry',
          retryAfter: 5,
        });
      }
      return res.status(503).json({ error: 'Service unavailable' });
    }

    try {
      const ctx = { user: req.user, client: req.client };
      const result = await searchService.search(ctx, anvil, req.body);
      res.json(result);
    } catch (err) {
      if (err instanceof ServiceError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error('Search endpoint error:', err);
      throw err;
    }
  });

  return router;
}
