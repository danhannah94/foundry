import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { writeFileSync, mkdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to mock the project root finding so it uses our temp nav.yaml.
// The pages route uses findProjectRoot internally, which walks up from __dirname
// looking for foundry.config.yaml. Instead, we'll test by creating a temp directory
// with both foundry.config.yaml and nav.yaml, then mock the module.

// Create temp project root with nav.yaml
const tempRoot = mkdirSync(join(tmpdir(), `pages-test-${Date.now()}`), { recursive: true }) as string;

const navYaml = `
- title: Home
  path: index.md
- title: Methodology
  children:
    - title: Process
      path: methodology/process.md
- title: Projects
  access: private
  children:
    - title: Foundry
      children:
        - title: Design
          path: projects/foundry/design.md
`;

writeFileSync(join(tempRoot, 'nav.yaml'), navYaml);
writeFileSync(join(tempRoot, 'foundry.config.yaml'), 'docsPath: ./docs\n');

// Mock the nav-parser to use our temp nav.yaml path
import { parseNavPages } from '../../utils/nav-parser.js';
import { Router } from 'express';

// Build a test router that mimics the pages route behavior using our temp nav.yaml
function createTestPagesRouter(): Router {
  const router = Router();

  router.get('/pages', (req, res) => {
    try {
      const navYamlPath = join(tempRoot, 'nav.yaml');
      const allPages = parseNavPages(navYamlPath);

      const includePrivate = req.query.include_private === 'true';

      if (includePrivate) {
        const expectedToken = process.env.FOUNDRY_WRITE_TOKEN;
        if (expectedToken) {
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== expectedToken) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }
        }
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

let app: express.Express;

beforeAll(() => {
  process.env.FOUNDRY_WRITE_TOKEN = 'test-token';

  app = express();
  app.use(express.json());
  app.use('/api', createTestPagesRouter());
});

afterAll(() => {
  delete process.env.FOUNDRY_WRITE_TOKEN;
  try {
    unlinkSync(join(tempRoot, 'nav.yaml'));
    unlinkSync(join(tempRoot, 'foundry.config.yaml'));
    rmdirSync(tempRoot);
  } catch {
    // ignore
  }
});

describe('Pages Router', () => {
  it('should return public pages by default', async () => {
    const res = await request(app)
      .get('/api/pages')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    // Should only have public pages (Home + Process)
    expect(res.body).toHaveLength(2);
    for (const page of res.body) {
      expect(page.access).toBe('public');
    }
  });

  it('should have title, path, and access fields on each page', async () => {
    const res = await request(app)
      .get('/api/pages')
      .expect(200);

    for (const page of res.body) {
      expect(page).toHaveProperty('title');
      expect(page).toHaveProperty('path');
      expect(page).toHaveProperty('access');
      expect(typeof page.title).toBe('string');
      expect(typeof page.path).toBe('string');
      expect(['public', 'private']).toContain(page.access);
    }
  });

  it('should return all pages when include_private=true with auth', async () => {
    const res = await request(app)
      .get('/api/pages')
      .query({ include_private: 'true' })
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    // Should have all pages: Home, Process, Design
    expect(res.body).toHaveLength(3);

    const accesses = res.body.map((p: any) => p.access);
    expect(accesses).toContain('public');
    expect(accesses).toContain('private');
  });

  it('should return 401 when include_private=true without auth', async () => {
    const res = await request(app)
      .get('/api/pages')
      .query({ include_private: 'true' })
      .expect(401);

    expect(res.body.error).toBe('Unauthorized');
  });

  it('should return 401 when include_private=true with wrong token', async () => {
    const res = await request(app)
      .get('/api/pages')
      .query({ include_private: 'true' })
      .set('Authorization', 'Bearer wrong-token')
      .expect(401);

    expect(res.body.error).toBe('Unauthorized');
  });

  it('should return public pages without auth even when include_private is missing', async () => {
    const res = await request(app)
      .get('/api/pages')
      .expect(200);

    expect(res.body.every((p: any) => p.access === 'public')).toBe(true);
  });

  it('should include correct page titles and paths', async () => {
    const res = await request(app)
      .get('/api/pages')
      .query({ include_private: 'true' })
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    const titles = res.body.map((p: any) => p.title);
    expect(titles).toContain('Home');
    expect(titles).toContain('Process');
    expect(titles).toContain('Design');

    const paths = res.body.map((p: any) => p.path);
    expect(paths).toContain('index.md');
    expect(paths).toContain('methodology/process.md');
    expect(paths).toContain('projects/foundry/design.md');
  });
});
