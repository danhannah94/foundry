import { Router } from 'express';
import type { AnvilHolder } from '../anvil-holder.js';
import { requireAuth } from '../middleware/auth.js';
import * as mgmtService from '../services/mgmt.js';
import { ServiceError } from '../services/errors.js';

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
      const ctx = { user: req.user, client: req.client };
      const result = await mgmtService.reindex(ctx, anvil);
      res.json(result);
    } catch (error: any) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ error: error.message });
      }
      res.status(500).json({ error: 'Reindex failed', message: error.message });
    }
  });

  return router;
}
