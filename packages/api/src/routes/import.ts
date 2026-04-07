import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { importFromRepo } from '../import.js';
import { getDocsPath } from '../config.js';
import { invalidateContent } from '../index.js';

export function createImportRouter(): Router {
  const router = Router();

  router.post('/import', requireAuth, async (req, res) => {
    const { repo, branch, prefix } = req.body;

    if (!repo || typeof repo !== 'string') {
      return res.status(400).json({ error: 'repo is required and must be a string' });
    }

    try {
      const contentDir = getDocsPath();
      const result = await importFromRepo({
        repoUrl: repo,
        branch: branch || 'main',
        prefix: prefix || 'docs/',
        contentDir,
      });

      // Trigger full Anvil reindex + cache invalidation after import
      await invalidateContent();

      res.json(result);
    } catch (error: any) {
      console.error('[import] Import failed:', error);
      res.status(500).json({ error: 'Import failed', message: error.message });
    }
  });

  return router;
}
