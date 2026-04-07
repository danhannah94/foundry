import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { syncToGithub } from '../sync.js';
import { getDocsPath } from '../config.js';

export function createSyncRouter(): Router {
  const router = Router();

  router.post('/sync', requireAuth, async (req, res) => {
    const { remote, branch } = req.body || {};

    const remoteUrl = remote || process.env.SYNC_REMOTE_URL;
    if (!remoteUrl || typeof remoteUrl !== 'string') {
      return res.status(400).json({
        error: 'remote is required — provide in body or set SYNC_REMOTE_URL env var',
      });
    }

    try {
      const contentDir = getDocsPath();
      const result = await syncToGithub({
        contentDir,
        remoteUrl,
        branch: branch || 'main',
        deployKeyPath: process.env.DEPLOY_KEY_PATH || undefined,
      });

      res.json(result);
    } catch (error: any) {
      console.error('[sync] GitHub sync failed:', error);
      res.status(500).json({ error: 'Sync failed', message: error.message });
    }
  });

  return router;
}
