import { Router, Request, Response } from 'express';
import type { AnvilHolder } from '../anvil-holder.js';

interface HealthResponse {
  status: 'ok';
  version: string;
  anvil: {
    status: string;
    totalPages?: number;
    totalChunks?: number;
    lastIndexed?: string | null;
    error?: string;
  };
}

/**
 * Creates the health router.
 * Always returns 200 — the server is healthy even if Anvil is still loading.
 */
export function createHealthRouter(holder: AnvilHolder): Router {
  const router = Router();

  router.get('/health', async (req: Request, res: Response<HealthResponse>) => {
    const anvil = holder.get();

    if (anvil) {
      try {
        const status = await anvil.getStatus();
        return res.json({
          status: 'ok',
          version: '0.2.0',
          anvil: {
            status: 'ready',
            totalPages: status.total_pages,
            totalChunks: status.total_chunks,
            lastIndexed: status.last_indexed,
          },
        });
      } catch (error) {
        console.warn('Anvil status error:', error);
        return res.json({
          status: 'ok',
          version: '0.2.0',
          anvil: {
            status: 'ready',
            totalPages: 0,
            totalChunks: 0,
            lastIndexed: null,
          },
        });
      }
    }

    // Anvil not yet available
    const response: HealthResponse = {
      status: 'ok',
      version: '0.2.0',
      anvil: {
        status: holder.status === 'error' ? 'error' : holder.status,
        ...(holder.error ? { error: holder.error } : {}),
      },
    };

    res.json(response);
  });

  return router;
}
