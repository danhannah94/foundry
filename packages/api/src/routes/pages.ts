import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseNavPages } from '../utils/nav-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Walks up the directory tree to find the project root containing foundry.config.yaml.
 */
function findProjectRoot(startDir: string): string {
  let current = startDir;

  while (current !== dirname(current)) {
    try {
      readFileSync(join(current, 'foundry.config.yaml'), 'utf8');
      return current;
    } catch {
      current = dirname(current);
    }
  }

  throw new Error('Could not find foundry.config.yaml in any parent directory');
}

/**
 * Check if the request has a valid auth token.
 */
function isAuthenticated(req: Request): boolean {
  const expectedToken = process.env.FOUNDRY_WRITE_TOKEN;
  if (!expectedToken) return true; // dev mode — no token required

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

  return authHeader.slice(7) === expectedToken;
}

export function createPagesRouter(): Router {
  const router = Router();

  router.get('/pages', (req: Request, res: Response) => {
    try {
      const projectRoot = findProjectRoot(__dirname);
      const navYamlPath = join(projectRoot, 'nav.yaml');
      const allPages = parseNavPages(navYamlPath);

      const includePrivate = req.query.include_private === 'true';

      if (includePrivate && !isAuthenticated(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const pages = includePrivate
        ? allPages
        : allPages.filter(p => p.access === 'public');

      res.json(pages);
    } catch (error) {
      console.error('Error listing pages:', error);
      res.status(500).json({ error: 'Failed to list pages' });
    }
  });

  return router;
}
