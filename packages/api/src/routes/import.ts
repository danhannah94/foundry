import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as mgmtService from '../services/mgmt.js';
import { ServiceError } from '../services/errors.js';

export function createImportRouter(): Router {
  const router = Router();

  router.post('/import', requireAuth, async (req, res) => {
    try {
      const ctx = { user: req.user, client: req.client };
      const result = await mgmtService.importRepo(ctx, req.body);
      res.json(result);
    } catch (error: any) {
      if (error instanceof ServiceError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('[import] Import failed:', error);
      res.status(500).json({ error: 'Import failed', message: error.message });
    }
  });

  return router;
}
