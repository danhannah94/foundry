import { Router, Request, Response } from 'express';
import type { AnvilHolder } from '../anvil-holder.js';
import * as mgmtService from '../services/mgmt.js';

/**
 * Creates the health router.
 * Always returns 200 — the server is healthy even if Anvil is still loading.
 */
export function createHealthRouter(holder: AnvilHolder): Router {
  const router = Router();

  router.get('/health', async (req: Request, res: Response) => {
    const ctx = { user: req.user, client: req.client };
    const result = await mgmtService.getStatus(ctx, holder);
    res.json(result);
  });

  return router;
}
