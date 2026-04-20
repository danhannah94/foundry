/**
 * Tests for FND-E12-S9: /api/pages scope-aware auth.
 *
 * Matrix covered:
 *   - AC4: include_private=true + OAuth user WITHOUT docs:read:private → 403
 *   - AC5: include_private=true + no auth                              → 401 w/ WWW-Authenticate
 *   - AC6: include_private=false (or unset) + no auth                  → 200, public pages only
 *   - AC4+ve: include_private=true + OAuth user WITH docs:read:private → 200, all pages
 *   - Legacy FOUNDRY_WRITE_TOKEN still works (backcompat)
 */

// Module-top env: WWW-Authenticate builder requires this.
process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.test';

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';
import { createPagesRouter } from '../pages.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, tokensDao, usersDao } from '../../oauth/dao.js';
import * as navGenerator from '../../utils/nav-generator.js';
import * as config from '../../config.js';

// ─── Test DB setup ────────────────────────────────────────────────────────────

const testDbPath = join(
  tmpdir(),
  `foundry-pages-test-${process.pid}-${Date.now()}.db`
);

let userId: string;
let clientId: string;

// Two pages — one public, one private — covers both filtering branches.
const MOCK_PAGES = [
  { title: 'Public Doc', path: 'methodology/process.md', access: 'public' as const },
  { title: 'Private Doc', path: 'projects/secret/design.md', access: 'private' as const },
];

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  closeDb();
  getDb();

  const user = usersDao.upsert({ github_login: 'eve', github_id: 555555 });
  userId = user.id;

  const { id } = clientsDao.register({
    name: 'Pages Test Connector',
    redirect_uris: 'https://example.com/cb',
    client_type: 'autonomous',
  });
  clientId = id;
});

afterAll(() => {
  closeDb();
  try {
    unlinkSync(testDbPath);
  } catch {
    /* ignore */
  }
  delete process.env.FOUNDRY_DB_PATH;
});

// ─── Shared app factory ───────────────────────────────────────────────────────

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createPagesRouter());
  return app;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(navGenerator, 'generateNavPages').mockReturnValue([...MOCK_PAGES]);
  vi.spyOn(config, 'getDocsPath').mockReturnValue('/fake/docs');
  // Ensure no lingering legacy token unless a test opts in.
  delete process.env.FOUNDRY_WRITE_TOKEN;
});

// ═══════════════════════════════════════════════════════════════════════════
// AC6 — no flag (or flag=false) → public-only, no auth required
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/pages — no include_private flag', () => {
  it('AC6 — no flag + no auth → 200 with public pages only', async () => {
    const res = await request(makeApp()).get('/api/pages').expect(200);

    expect(res.body).toEqual([
      { title: 'Public Doc', path: 'methodology/process.md', access: 'public' },
    ]);
  });

  it('AC6 — include_private=false + no auth → 200 with public pages only', async () => {
    const res = await request(makeApp())
      .get('/api/pages?include_private=false')
      .expect(200);

    expect(res.body).toEqual([
      { title: 'Public Doc', path: 'methodology/process.md', access: 'public' },
    ]);
  });

  it('no flag + valid OAuth token (any scope) → still public-only (flag controls, not scope)', async () => {
    const { access_token } = tokensDao.mint({
      client_id: clientId,
      user_id: userId,
      scope: 'docs:read docs:read:private',
    });

    const res = await request(makeApp())
      .get('/api/pages')
      .set('Authorization', `Bearer ${access_token}`)
      .expect(200);

    // Flag absent → public-only regardless of what the token grants.
    expect(res.body).toEqual([
      { title: 'Public Doc', path: 'methodology/process.md', access: 'public' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC5 — include_private=true without auth → 401 WWW-Authenticate
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/pages?include_private=true — unauthenticated', () => {
  it('AC5 — no auth + legacy token configured → 401 with WWW-Authenticate', async () => {
    // S7 requireAuth only 401s on missing header when auth is "configured"
    // (legacy env var set OR real Bearer presented). Set the env var so
    // missing-header lands in the 401 path, exercising AC5's WWW-Authenticate.
    process.env.FOUNDRY_WRITE_TOKEN = 'some-legacy-token';

    const res = await request(makeApp())
      .get('/api/pages?include_private=true')
      .expect(401);

    expect(res.body).toEqual({ error: 'Unauthorized' });
    const www = res.headers['www-authenticate'];
    expect(www).toBeDefined();
    expect(www).toContain('Bearer ');
    expect(www).toContain('realm="foundry"');
    expect(www).toContain(
      'resource_metadata="https://foundry.test/.well-known/oauth-protected-resource"'
    );
  });

  it('AC5 — invalid Bearer token → 401 with error="invalid_token"', async () => {
    const res = await request(makeApp())
      .get('/api/pages?include_private=true')
      .set('Authorization', 'Bearer this-is-not-a-real-token')
      .expect(401);

    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC4 — include_private=true with auth but insufficient scope → 403
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/pages?include_private=true — insufficient scope', () => {
  it('AC4 — OAuth token WITHOUT docs:read:private → 403 insufficient_scope', async () => {
    const { access_token } = tokensDao.mint({
      client_id: clientId,
      user_id: userId,
      scope: 'docs:read', // explicitly lacks docs:read:private
    });

    const res = await request(makeApp())
      .get('/api/pages?include_private=true')
      .set('Authorization', `Bearer ${access_token}`)
      .expect(403);

    expect(res.body.error).toBe('insufficient_scope');
    expect(res.body.error_description).toBe('Requires scope: docs:read:private');
    expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
    expect(res.headers['www-authenticate']).toContain('scope="docs:read:private"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Authenticated happy path — include_private=true with scope → 200, all pages
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/pages?include_private=true — authorized', () => {
  it('OAuth token WITH docs:read:private → 200 with all pages (public + private)', async () => {
    const { access_token } = tokensDao.mint({
      client_id: clientId,
      user_id: userId,
      scope: 'docs:read docs:read:private',
    });

    const res = await request(makeApp())
      .get('/api/pages?include_private=true')
      .set('Authorization', `Bearer ${access_token}`)
      .expect(200);

    expect(res.body).toEqual(MOCK_PAGES);
  });

  it('legacy FOUNDRY_WRITE_TOKEN → 200 with all pages (backcompat — legacy inherits all scopes)', async () => {
    process.env.FOUNDRY_WRITE_TOKEN = 'legacy-break-glass';

    const res = await request(makeApp())
      .get('/api/pages?include_private=true')
      .set('Authorization', 'Bearer legacy-break-glass')
      .expect(200);

    expect(res.body).toEqual(MOCK_PAGES);
  });
});
