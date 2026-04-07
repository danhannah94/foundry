import { Router, Request, Response } from 'express';

interface WebhookState {
  lastUpdate: string | null;
  lastRef: string | null;
  lastError: string | null;
  status: 'idle';
  contentRef: string | null;
}

const state: WebhookState = {
  lastUpdate: null,
  lastRef: null,
  lastError: null,
  status: 'idle',
  contentRef: null,
};

export function getWebhookState(): WebhookState {
  return { ...state };
}

export function createWebhookRouter(): Router {
  const router = Router();

  // POST /webhooks/content-update — disabled, native content storage
  router.post('/webhooks/content-update', (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Content webhook disabled — Foundry uses native content storage',
    });
  });

  // GET /content/status — kept for start.sh readiness polling
  router.get('/content/status', (_req: Request, res: Response) => {
    res.json(getWebhookState());
  });

  return router;
}
