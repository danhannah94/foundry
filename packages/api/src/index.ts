import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { AnvilHolder } from './anvil-holder.js';
import { getDocsPath } from './config.js';
import { createHealthRouter } from './routes/health.js';
import { createDocsRouter } from './routes/docs.js';
import { createSearchRouter } from './routes/search.js';
import { createReindexRouter } from './routes/reindex.js';
import { createAnnotationsRouter } from './routes/annotations.js';
import { createReviewsRouter } from './routes/reviews.js';
import { createAccessRouter } from './routes/access.js';
import { createWebhookRouter } from './routes/webhook.js';
import { createPagesRouter } from './routes/pages.js';
import { createImportRouter } from './routes/import.js';
import { createDocCrudRouter } from './routes/doc-crud.js';
import { createSyncRouter } from './routes/sync.js';
import { createOauthRegisterRouter } from './routes/oauth-register.js';
import { createOauthGithubRouter } from './routes/oauth-github.js';
import { requireAuth, logAuthStatus } from './middleware/auth.js';
import { loadAccessMap, getAccessLevel } from './access.js';
import { generateAccessMap } from './access-map-generator.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp/server.js';
import { invalidateNavCache } from './utils/nav-generator.js';
import { createOauthDiscoveryRouter } from './routes/oauth-discovery.js';
import { createOauthRouter } from './routes/oauth.js';
import { createOauthTokenRouter } from './routes/oauth-token.js';

// Environment configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.FOUNDRY_PORT ? parseInt(process.env.FOUNDRY_PORT, 10) : 3001;
const STATIC_PATH = process.env.FOUNDRY_STATIC_PATH || join(__dirname, '../../site/dist');

// Anvil holder — lazy container, available after background init
const anvilHolder = new AnvilHolder();

/**
 * Returns the AnvilHolder instance.
 * Used by webhook router to check Anvil availability.
 */
export function getAnvilHolder(): AnvilHolder {
  return anvilHolder;
}

/**
 * Invalidate caches and reindex Anvil after content changes.
 * Called by future CRUD routes (S5a) and any content mutation path.
 */
export async function invalidateContent(changedFiles?: string[]): Promise<void> {
  const mdFiles = changedFiles?.filter(f => f.endsWith('.md')) ?? [];

  // Invalidate API-side nav cache
  invalidateNavCache();

  // Invalidate Astro SSR caches (page cache + nav cache)
  try {
    const proxyPort = process.env.PORT || '4321';
    const invalidateRes = await fetch(`http://127.0.0.1:${proxyPort}/api/invalidate-cache.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.CACHE_INVALIDATION_SECRET || 'foundry-internal',
      },
    });
    if (invalidateRes.ok) {
      console.log('[content] Astro page cache + nav cache invalidated');
    } else {
      console.warn(`[content] Cache invalidation returned ${invalidateRes.status}`);
    }
  } catch (error) {
    console.error('[content] Failed to invalidate Astro caches:', error);
  }

  // Anvil reindex (if available)
  const anvil = anvilHolder.get();
  if (anvil) {
    try {
      if (changedFiles && mdFiles.length > 0 && typeof anvil.reindexFiles === 'function') {
        console.log(`[content] Delta reindexing ${mdFiles.length} changed files`);
        await anvil.reindexFiles(mdFiles);
      } else {
        console.log('[content] Triggering full Anvil reindex');
        await anvil.index();
      }
    } catch (error) {
      console.error('[content] Anvil reindex failed:', error);
    }
  } else {
    console.log('[content] Anvil not ready, skipping reindex (will be indexed on init)');
  }
}

interface ErrorWithStatus extends Error {
  status?: number;
  statusCode?: number;
}

/**
 * Global error handler middleware
 */
function errorHandler(
  err: ErrorWithStatus,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const status = err.status || err.statusCode || 500;

  // Log error for debugging (but don't expose stack trace to client)
  console.error('Error occurred:', {
    message: err.message,
    status,
    path: req.path,
    method: req.method,
  });

  // Return JSON error response
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
}

/**
 * Initialize and start the Foundry API server
 */
async function startServer(): Promise<void> {
  try {
    const app = express();

    // CORS configuration — allow GitHub Pages (static site), localhost
    // (dev), and claude.ai (Claude.ai Connectors performs OAuth discovery
    // + DCR from the browser and requires an origin echo with
    // credentials: true).
    const corsOptions = {
      origin: [
        'https://danhannah94.github.io',
        'https://claude.ai',
        /^http:\/\/localhost:\d+$/,  // Allow any localhost port
      ],
      credentials: true,
    };
    app.use(cors(corsOptions));

    // JSON parsing middleware
    app.use(express.json());

    // Get docs path from configuration
    const docsPath = getDocsPath();
    console.log(`📁 Using docs path: ${docsPath}`);
    console.log('📦 Native content mode — no GitHub fetch required');

    // Generate and load access map
    console.log('📋 Generating access map from config...');
    try {
      const configPath = join(process.cwd(), 'foundry.config.yaml');
      generateAccessMap(configPath, docsPath);
      loadAccessMap(docsPath);
      console.log('✅ Access map generated and loaded');
    } catch (error) {
      console.warn('⚠️ Could not generate access map:', error);
      loadAccessMap(docsPath); // Try loading existing .access.json as fallback
    }

    // MCP Streamable HTTP endpoint.
    //
    // Identity flow: requireAuth validates the Bearer token and populates
    // req.user / req.client. The handler builds an AuthContext from those
    // and hands it to createMcpServer(), where tool handlers thread it
    // directly into service calls. No HTTP loopback — MCP tools run against
    // the same services REST routes use.
    //
    // Transport lifecycle: stateless mode (sessionIdGenerator: undefined).
    // Each POST builds a Server + Transport pair for the request, runs
    // handleRequest, and tears down on `res.close`. This matches the SDK's
    // `simpleStatelessStreamableHttp` example and keeps the mount simple
    // for a single-node deployment. Session resumption isn't needed today
    // because Claude Code / Claude.ai Connectors don't assume it.
    app.post('/mcp', requireAuth, async (req, res) => {
      const ctx = { user: req.user, client: req.client };
      const mcpServer = createMcpServer(ctx, anvilHolder);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        transport.close();
        mcpServer.close();
      });

      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('MCP request error:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    // GET/DELETE on /mcp: stateless transport doesn't need them. Respond
    // 405 so a misconfigured client gets a clear signal instead of a
    // cryptic hang. (Server-initiated notifications and session
    // termination require stateful mode.)
    const methodNotAllowed: express.RequestHandler = (_req, res) => {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
    };
    app.get('/mcp', requireAuth, methodNotAllowed);
    app.delete('/mcp', requireAuth, methodNotAllowed);

    // Mount webhook router (legacy — returns 410 Gone for POST)
    app.use('/api', createWebhookRouter());

    // Mount access router (always available, no anvil dependency)
    app.use('/api', createAccessRouter());

    // Mount pages router (no auth middleware — route handles auth internally)
    app.use('/api', createPagesRouter());

    // Mount doc CRUD router FIRST — its specific routes (GET/PUT/POST/DELETE
    // /docs/:path/sections/:heading) must register before the docs router's
    // greedy GET /docs/:path(*) wildcard, which would otherwise swallow them.
    app.use('/api', createDocCrudRouter());

    // Mount Anvil-dependent routers — always mounted, holder provides lazy access
    app.use('/api', createHealthRouter(anvilHolder));
    app.use('/api', createDocsRouter(anvilHolder));
    app.use('/api', createSearchRouter(anvilHolder));
    app.use('/api', createReindexRouter(anvilHolder));

    // Create protected routers by wrapping with auth middleware
    const protectedAnnotationsRouter = express.Router();
    protectedAnnotationsRouter.use('/annotations', requireAuth);
    protectedAnnotationsRouter.use(createAnnotationsRouter());
    app.use('/api', protectedAnnotationsRouter);

    const protectedReviewsRouter = express.Router();
    protectedReviewsRouter.use('/reviews', requireAuth);
    protectedReviewsRouter.use(createReviewsRouter());
    app.use('/api', protectedReviewsRouter);

    // Mount import router (auth-protected internally via requireAuth in route)
    app.use('/api', createImportRouter());

    // Mount sync router (auth-protected internally via requireAuth in route)
    app.use('/api', createSyncRouter());

    // Mount OAuth DCR router at app root (RFC 7591: /oauth/register is host-root)
    app.use('/', createOauthRegisterRouter());

    // Mount GitHub OAuth callback router (S2: /oauth/github/callback)
    app.use('/', createOauthGithubRouter());

    // Mount OAuth authorize + consent router (S5: /oauth/authorize, /oauth/consent)
    app.use('/', createOauthRouter());

    // Mount OAuth token router (S6: POST /oauth/token — authorization_code + refresh_token grants)
    app.use('/', createOauthTokenRouter());

    // Access control for docs:
    // - Static HTML pages: client-side nav filtering hides private docs (no server gate)
    // - API endpoints (/api/annotations, /api/reviews): Bearer token auth (requireAuth)
    // - Search API: filters private results for unauthenticated requests
    // - MCP tools: require auth_token for private results
    // Server-side static gating removed — browser navigation doesn't send Bearer headers.
    // TODO: Add cookie-based auth if server-side HTML gating is needed later.

    // Mount OAuth discovery endpoints at app root (/.well-known/*) — spec requires host root
    app.use('/', createOauthDiscoveryRouter());

    // Static file serving — serve the Astro build output
    // Mount at /foundry to match Astro's base path, and at / for API/root access
    app.use('/foundry', express.static(STATIC_PATH));
    app.use(express.static(STATIC_PATH));

    // Catch-all fallback for client-side routing — serve index.html for non-API, non-MCP routes
    app.get('*', (req, res) => {
      // Don't catch API or MCP routes (covers both /mcp exact and /mcp/... subpaths).
      if (req.path.startsWith('/api/') || req.path === '/mcp' || req.path.startsWith('/mcp/')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(join(STATIC_PATH, 'index.html'));
    });

    // Global error handler (must be last)
    app.use(errorHandler);

    // Fail-loud startup check: OAuth discovery endpoints require FOUNDRY_OAUTH_ISSUER
    if (!process.env.FOUNDRY_OAUTH_ISSUER) {
      throw new Error('FOUNDRY_OAUTH_ISSUER env var is required for OAuth discovery endpoints');
    }

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Foundry API server running on port ${PORT}`);
      console.log(`📊 Health endpoint: http://localhost:${PORT}/api/health`);
      console.log(`📂 Static files: ${STATIC_PATH}`);
      console.log(`🔌 MCP Streamable HTTP endpoint: http://localhost:${PORT}/mcp`);
      console.log(`🌐 CORS enabled for GitHub Pages and localhost`);
      logAuthStatus();

      // Kick off Anvil init in the background (non-blocking).
      // Opt out with FOUNDRY_DISABLE_ANVIL=1 — useful for constrained
      // environments (e.g., emulated/QEMU builds that can't load the ONNX
      // embedding model) where semantic search isn't needed. Anvil-dependent
      // endpoints (health, search, reindex) already tolerate a null holder.
      if (process.env.FOUNDRY_DISABLE_ANVIL === '1') {
        console.log('🔇 Anvil disabled via FOUNDRY_DISABLE_ANVIL=1 (semantic search unavailable)');
      } else {
        console.log('🔧 Starting deferred Anvil initialization...');
        anvilHolder.init(docsPath)
          .then(() => {
            const anvil = anvilHolder.get();
            if (anvil) {
              console.log('📇 Running initial Anvil index (background)...');
              return anvil.index()
                .then((result: any) => {
                  console.log('✅ Anvil index complete:', result);

                  // Start file watcher after index completes (dev mode only)
                  if (process.env.NODE_ENV !== 'production') {
                    import('./file-watcher.js')
                      .then(({ startFileWatcher }) => startFileWatcher(docsPath, anvil))
                      .catch((err: any) => console.warn('⚠️ File watcher failed to start:', err));
                  }
                });
            } else {
              console.warn('⚠️ Anvil not available:', anvilHolder.error);
            }
          })
          .catch((error: any) => console.error('⚠️ Anvil background init failed:', error));
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions and rejections gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
startServer();
