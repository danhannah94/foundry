import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { getContentFetcher } from '../index.js';

interface WebhookState {
  lastUpdate: string | null;
  lastRef: string | null;
  lastError: string | null;
  status: 'idle' | 'updating' | 'ok' | 'error';
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

function verifySignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function createWebhookRouter(options: {
  onContentUpdated?: (changedFiles: string[], isInitialClone: boolean) => Promise<void>;
}): Router {
  const router = Router();
  const webhookSecret = process.env.WEBHOOK_SECRET;

  // POST /webhooks/content-update
  router.post('/webhooks/content-update', async (req: Request, res: Response) => {
    // Verify webhook secret is configured
    if (!webhookSecret) {
      console.warn('[webhook] WEBHOOK_SECRET not configured, rejecting');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    // Verify GitHub signature
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    if (!verifySignature(rawBody, signature, webhookSecret)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // Only handle push events
    const event = req.headers['x-github-event'] as string;
    if (event !== 'push') {
      return res.status(200).json({ status: 'ignored', event });
    }

    // Respond immediately — run pipeline async
    res.status(200).json({ status: 'accepted' });

    // Run the content update pipeline
    const fetcher = getContentFetcher();
    if (!fetcher) {
      console.warn('[webhook] Content fetcher not configured');
      return;
    }

    // Snapshot before pull
    const snapshotRef = await fetcher.snapshotRef() ?? null;

    state.status = 'updating';
    try {
      const result = await fetcher.pull();
      if (!result) {
        state.status = 'ok';
        return;
      }

      state.lastRef = result.ref;
      state.lastUpdate = new Date().toISOString();

      // Call the content update callback (cache invalidation, nav regen, Anvil reindex)
      if (options.onContentUpdated) {
        try {
          await options.onContentUpdated(result.changedFiles, result.isInitialClone);
        } catch (updateError: any) {
          // Rollback to last-known-good
          if (snapshotRef) {
            await fetcher.restoreRef(snapshotRef);
            console.error('[webhook] Content update callback failed, rolled back:', updateError);
          }
          throw updateError; // Re-throw to set error state
        }
      }

      state.contentRef = result.ref;
      state.status = 'ok';
      state.lastError = null;
      console.log(`[webhook] Content update complete: ${result.ref.substring(0, 8)}`);
    } catch (error: any) {
      state.status = 'error';
      state.lastError = error.message || String(error);
      console.error('[webhook] Content update failed:', error);
    }
  });

  // GET /content/status
  router.get('/content/status', (_req: Request, res: Response) => {
    res.json(getWebhookState());
  });

  return router;
}
