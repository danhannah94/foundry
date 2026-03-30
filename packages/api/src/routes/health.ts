import { Router, Request, Response } from 'express';
import type { AnvilInstance } from '../types/anvil.js';

interface HealthResponse {
  status: 'ok';
  version: string;
  anvil: {
    totalPages: number;
    totalChunks: number;
    lastIndexed: string | null;
  };
}

/**
 * Creates the health router
 */
export function createHealthRouter(anvil: AnvilInstance): Router {
  const router = Router();

  router.get('/health', async (req: Request, res: Response<HealthResponse>) => {
    try {
      // Get status from Anvil, with defaults if no index exists yet
      const anvilStatus = await anvil.getStatus();

      const response: HealthResponse = {
        status: 'ok',
        version: '0.2.0',
        anvil: {
          totalPages: anvilStatus?.totalPages || 0,
          totalChunks: anvilStatus?.totalChunks || 0,
          lastIndexed: anvilStatus?.lastIndexed || null,
        },
      };

      res.json(response);
    } catch (error) {
      // If Anvil has issues, still return health with zeros
      console.warn('Anvil status error:', error);

      const response: HealthResponse = {
        status: 'ok',
        version: '0.2.0',
        anvil: {
          totalPages: 0,
          totalChunks: 0,
          lastIndexed: null,
        },
      };

      res.json(response);
    }
  });

  return router;
}