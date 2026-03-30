import { Router, Request, Response } from 'express';
import type { Anvil } from '@claymore-dev/anvil';

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
export function createHealthRouter(anvil: Anvil): Router {
  const router = Router();

  router.get('/health', async (req: Request, res: Response<HealthResponse>) => {
    try {
      const status = await anvil.getStatus();

      const response: HealthResponse = {
        status: 'ok',
        version: '0.2.0',
        anvil: {
          totalPages: status.total_pages,
          totalChunks: status.total_chunks,
          lastIndexed: status.last_indexed,
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