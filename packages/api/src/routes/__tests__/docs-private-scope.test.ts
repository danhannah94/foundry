/**
 * Tests for issue #151 — enforce `docs:read:private` scope on GET /docs/:path(*).
 *
 * Pre-S9 (and pre-this-fix), any valid Bearer token unlocked a private doc
 * read — the route ran `requireAuth` but never checked `req.user.scopes`.
 * S9 fixed the same vulnerability class on /api/search and /api/pages; this
 * closes the equivalent gap on /docs/:path(*). Same #99 ancestor.
 *
 * Matrix:
 *   - Private path + no auth                                      → 401 + WWW-Authenticate
 *   - Private path + authed WITHOUT docs:read:private             → 403 insufficient_scope
 *   - Private path + authed WITH docs:read:private                → 200 (continues to anvil)
 *   - Public path + no auth                                       → 200 (unchanged; pre-existing behavior)
 */

// Module-top env — WWW-Authenticate builder (middleware/auth.ts) requires this.
process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.test';

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { join } from 'path';
import { tmpdir } from 'os';
import { unlinkSync } from 'fs';

import type { Anvil } from '@claymore-dev/anvil';
import { AnvilHolder } from '../../anvil-holder.js';
import { createDocsRouter } from '../docs.js';
import { getDb, closeDb } from '../../db.js';
import { clientsDao, tokensDao, usersDao } from '../../oauth/dao.js';
import * as access from '../../access.js';

// ─── Shared DB / test fixtures ─────────────────────────────────────────────

const testDbPath = join(
  tmpdir(),
  `foundry-docs-private-scope-test-${process.pid}-${Date.now()}.db`
);

let userId: string;
let clientId: string;

const PRIVATE_PATH = 'projects/secret/design.md';
const PRIVATE_PATH_NO_EXT = 'projects/secret/design';

beforeAll(() => {
  process.env.FOUNDRY_DB_PATH = testDbPath;
  closeDb();
  getDb();

  const user = usersDao.upsert({ github_login: 'privateuser', github_id: 777777 });
  userId = user.id;

  const { id } = clientsDao.register({
    name: 'Private Docs Test Connector',
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

// ─── Mock anvil (needed for the scope=granted happy path) ─────────────────

function createMockAnvil(): Anvil {
  return {
    listPages: vi.fn(),
    getPage: vi.fn(),
    getStatus: vi.fn(),
    getSection: vi.fn(),
  } as any;
}

function createReadyHolder(mockAnvil: Anvil): AnvilHolder {
  const holder = new AnvilHolder();
  (holder as any).anvil = mockAnvil;
  (holder as any)._status = 'ready';
  return holder;
}

function makeApp(): { app: express.Express; mockAnvil: Anvil } {
  const mockAnvil = createMockAnvil();
  // Seed a minimal getPage response for happy-path assertions.
  vi.mocked(mockAnvil.getPage).mockResolvedValue({
    file_path: PRIVATE_PATH,
    title: 'Private Design Doc',
    chunks: [
      {
        ordinal: 0,
        heading_text: 'Overview',
        heading_level: 1,
        char_count: 42,
        content: 'This is a private document...',
      },
    ],
    last_modified: '2026-04-20T00:00:00Z',
  } as any);

  const app = express();
  app.use(express.json());
  app.use('/api', createDocsRouter(createReadyHolder(mockAnvil)));
  return { app, mockAnvil };
}

// Force the route's access check to treat PRIVATE_PATH as private.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(access, 'getAccessLevel').mockImplementation((p: string) => {
    if (p === PRIVATE_PATH || p === `${PRIVATE_PATH_NO_EXT}.md`) return 'private';
    return 'public';
  });
  delete process.env.FOUNDRY_WRITE_TOKEN;
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('GET /docs/:path — private doc gated by docs:read:private scope (#151)', () => {
  it('private path + no auth → 401 with WWW-Authenticate', async () => {
    // S7 requireAuth only 401s on missing header when auth is "configured"
    // (legacy token env var set). Setting it here ensures the no-header case
    // exercises the 401 branch instead of dev-mode passthrough.
    process.env.FOUNDRY_WRITE_TOKEN = 'token-just-to-configure-auth';
    const { app } = makeApp();
    const res = await request(app).get(`/api/docs/${PRIVATE_PATH_NO_EXT}`).expect(401);
    expect(res.headers['www-authenticate']).toMatch(/Bearer realm="foundry"/);
    expect(res.headers['www-authenticate']).toMatch(
      /resource_metadata="https:\/\/foundry\.test\/\.well-known\/oauth-protected-resource"/
    );
  });

  it('private path + authed WITHOUT docs:read:private → 403 insufficient_scope', async () => {
    const { app } = makeApp();
    const { access_token } = tokensDao.mint({
      client_id: clientId,
      user_id: userId,
      scope: 'docs:read docs:write', // no private!
    });

    const res = await request(app)
      .get(`/api/docs/${PRIVATE_PATH_NO_EXT}`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(403);

    expect(res.body.error).toBe('insufficient_scope');
    expect(res.body.error_description).toMatch(/docs:read:private/);
    expect(res.headers['www-authenticate']).toMatch(/scope="docs:read:private"/);
  });

  it('private path + authed WITH docs:read:private → 200 (passes through to handler)', async () => {
    const { app, mockAnvil } = makeApp();
    const { access_token } = tokensDao.mint({
      client_id: clientId,
      user_id: userId,
      scope: 'docs:read docs:read:private',
    });

    const res = await request(app)
      .get(`/api/docs/${PRIVATE_PATH_NO_EXT}`)
      .set('Authorization', `Bearer ${access_token}`)
      .expect(200);

    expect(res.body.path).toBe(PRIVATE_PATH);
    expect(res.body.title).toBe('Private Design Doc');
    expect(mockAnvil.getPage).toHaveBeenCalled();
  });

  it('private path + legacy FOUNDRY_WRITE_TOKEN → 200 (break-glass inherits all scopes)', async () => {
    // Break-glass path: requireAuth gives the legacy principal full scopes
    // including docs:read:private. Documented behavior for the 30-day
    // dual-auth window.
    process.env.FOUNDRY_WRITE_TOKEN = 'break-glass-token-123';
    const { app, mockAnvil } = makeApp();

    const res = await request(app)
      .get(`/api/docs/${PRIVATE_PATH_NO_EXT}`)
      .set('Authorization', 'Bearer break-glass-token-123')
      .expect(200);

    expect(res.body.title).toBe('Private Design Doc');
    expect(mockAnvil.getPage).toHaveBeenCalled();
  });

  it('public path + no auth → 200 (unchanged; auth gate only runs on private paths)', async () => {
    const { app, mockAnvil } = makeApp();
    const publicPath = 'methodology/process';
    // Seed getPage for the public path as well.
    vi.mocked(mockAnvil.getPage).mockResolvedValue({
      file_path: 'methodology/process.md',
      title: 'CSDLC Process',
      chunks: [{ ordinal: 0, heading_text: 'Purpose', heading_level: 1, char_count: 10, content: 'x' }],
      last_modified: '2026-04-20T00:00:00Z',
    } as any);

    await request(app).get(`/api/docs/${publicPath}`).expect(200);
  });
});
