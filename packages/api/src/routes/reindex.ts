import { Router } from 'express';
import type { AnvilHolder } from '../anvil-holder.js';
import { requireAuth } from '../middleware/auth.js';

export function createReindexRouter(holder: AnvilHolder): Router {
  const router = Router();

  router.post('/reindex', requireAuth, async (req, res) => {
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
      const result = await anvil.index();
      res.json({ status: 'complete', ...result });
    } catch (error: any) {
      res.status(500).json({ error: 'Reindex failed', message: error.message });
    }
  });

  return router;
}
