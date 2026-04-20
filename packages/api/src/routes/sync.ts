import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as docsService from '../services/docs.js';
import { ServiceError } from '../services/errors.js';

export function createSyncRouter(): Router {
  const router = Router();

  router.post('/sync', requireAuth, async (req, res) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await docsService.syncToGithub(ctx, req.body || {});
      res.json(result);
    } catch (error: any) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('[sync] GitHub sync failed:', error);
      res.status(500).json({ error: 'Sync failed', message: error.message });
    }
  });

  return router;
}
