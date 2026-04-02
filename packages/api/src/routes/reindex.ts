import { Router } from 'express';
import type { Anvil } from '@claymore-dev/anvil';
import { requireAuth } from '../middleware/auth.js';

export function createReindexRouter(anvil: Anvil): Router {
  const router = Router();

  router.post('/reindex', requireAuth, async (req, res) => {
    try {
      const result = await anvil.index();
      res.json({ status: 'complete', ...result });
    } catch (error: any) {
      res.status(500).json({ error: 'Reindex failed', message: error.message });
    }
  });

  return router;
}
