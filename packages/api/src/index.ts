import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadAnvil } from './anvil-loader.js';
import { ContentFetcher } from './content-fetcher.js';
import { getDocsPath, getCloneDir } from './config.js';
import { createHealthRouter } from './routes/health.js';
import { createDocsRouter } from './routes/docs.js';
import { createSearchRouter } from './routes/search.js';
import { createReindexRouter } from './routes/reindex.js';
import { createAnnotationsRouter } from './routes/annotations.js';
import { createReviewsRouter } from './routes/reviews.js';
import { createAccessRouter } from './routes/access.js';
import { createWebhookRouter } from './routes/webhook.js';
import { createPagesRouter } from './routes/pages.js';
import { requireAuth, logAuthStatus } from './middleware/auth.js';
import { loadAccessMap, getAccessLevel } from './access.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from './mcp/server.js';

// Environment configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PORT = process.env.FOUNDRY_PORT ? parseInt(process.env.FOUNDRY_PORT, 10) : 3001;
const STATIC_PATH = process.env.FOUNDRY_STATIC_PATH || join(__dirname, '../../site/dist');

// Content fetcher singleton (initialized if CONTENT_REPO is set)
let contentFetcher: ContentFetcher | null = null;

/**
 * Returns the ContentFetcher instance, or null if not configured.
 * Used by webhook endpoint (F3-S2) to trigger pulls.
 */
export function getContentFetcher(): ContentFetcher | null {
  return contentFetcher;
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

    // CORS configuration - allow GitHub Pages and localhost
    const corsOptions = {
      origin: [
        'https://danhannah94.github.io',
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

    // Initialize content fetcher (runtime git clone/pull)
    const contentRepo = process.env.CONTENT_REPO;
    if (contentRepo) {
      const contentBranch = process.env.CONTENT_BRANCH || 'main';
      const deployKeyPath = process.env.DEPLOY_KEY_PATH;
      const cloneDir = getCloneDir();
      console.log(`📂 Clone target: ${cloneDir}`);
      contentFetcher = new ContentFetcher({
        contentDir: cloneDir,
        repoUrl: contentRepo,
        branch: contentBranch,
        deployKeyPath: deployKeyPath,
      });
      console.log(`📦 Content fetcher enabled: ${contentRepo} (branch: ${contentBranch})`);
      try {
        const result = await contentFetcher.pull();
        if (result) {
          console.log(`✅ Content ${result.isInitialClone ? 'cloned' : 'updated'}: ${result.ref.substring(0, 8)}`);
        }
      } catch (error) {
        console.error('⚠️ Initial content fetch failed (continuing without content):', error);
      }
    } else {
      console.log('📦 Content fetcher disabled (no CONTENT_REPO set)');
    }

    // Initialize Anvil (dynamic import — handles missing package gracefully)
    const anvil = await loadAnvil(docsPath);

    // Load access map from the static build directory
    console.log('📋 Loading access map...');
    loadAccessMap(STATIC_PATH);
    console.log('✅ Access map loaded successfully');

    // Create MCP server (uses HTTP API, no Anvil dependency)
    console.log('🔧 Initializing MCP server...');
    const mcpServer = createMcpServer();
    console.log('✅ MCP server initialized successfully');

    // Store active SSE transports
    const transports = new Map<string, SSEServerTransport>();

    // MCP SSE endpoints (only if mcpServer is available)
    // MCP SSE endpoints (always available — MCP uses HTTP API, not Anvil)
    app.get('/mcp/sse', async (req, res) => {
      try {
        const transport = new SSEServerTransport('/mcp/message', res);
        transports.set(transport.sessionId, transport);

        // Clean up transport when connection closes
        res.on('close', () => {
          transports.delete(transport.sessionId);
        });

        await mcpServer.connect(transport);
      } catch (error) {
        console.error('MCP SSE connection error:', error);
        res.status(500).json({ error: 'Failed to establish MCP connection' });
      }
    });

    app.post('/mcp/message', async (req, res) => {
      try {
        const sessionId = req.query.sessionId as string;
        const transport = transports.get(sessionId);

        if (!transport) {
          return res.status(404).json({ error: 'Session not found' });
        }

        await transport.handleMessage(req.body);
        res.status(200).end();
      } catch (error) {
        console.error('MCP message handling error:', error);
        res.status(500).json({ error: 'Failed to handle MCP message' });
      }
    });

    // Webhook content update callback
    // Defined here so it can capture `anvil` from the closure
    async function onContentUpdated(changedFiles: string[], isInitialClone: boolean) {
      const mdFiles = changedFiles.filter(f => f.endsWith('.md'));

      // TODO: Cache invalidation (invalidateAll/invalidateRoute) requires IPC to the Astro SSR process.
      // The page cache lives in packages/site, not packages/api.
      // For now, we log what would be invalidated. The page cache has a TTL
      // or can be manually cleared via /api/cache-stats endpoint.
      // TODO: Nav invalidation (invalidateNav) also lives in packages/site — same IPC needed.
      if (isInitialClone || changedFiles.length === 0) {
        console.log('[webhook] Full content refresh — all caches need invalidation');
      } else {
        console.log(`[webhook] Changed files: ${mdFiles.join(', ')}`);
      }

      // Anvil reindex (if available)
      if (anvil) {
        try {
          if (isInitialClone || mdFiles.length === 0) {
            console.log('[webhook] Triggering full Anvil reindex');
            await anvil.index();
          } else {
            console.log(`[webhook] Reindexing ${mdFiles.length} changed files`);
            await anvil.reindexFiles(mdFiles);
          }
        } catch (error) {
          console.error('[webhook] Anvil reindex failed:', error);
        }
      }
    }

    // Mount webhook router (works with or without Anvil)
    app.use('/api', createWebhookRouter({ onContentUpdated }));

    // Mount access router (always available, no anvil dependency)
    app.use('/api', createAccessRouter());

    // Mount pages router (no auth middleware — route handles auth internally)
    app.use('/api', createPagesRouter());

    // Mount routers only when anvil is available
    if (anvil) {
      app.use('/api', createHealthRouter(anvil));
      app.use('/api', createDocsRouter(anvil));
      app.use('/api', createSearchRouter(anvil));
      app.use('/api', createReindexRouter(anvil));
    } else {
      // Basic health endpoint when Anvil unavailable
      app.get('/api/health', (req, res) => res.json({
        status: 'ok',
        version: '0.2.0',
        anvil: null
      }));
      
      // Disabled endpoints when Anvil unavailable
      app.get('/api/docs', (req, res) => res.status(503).json({ error: 'Documentation service unavailable (Anvil disabled)' }));
      app.get('/api/search', (req, res) => res.status(503).json({ error: 'Search service unavailable (Anvil disabled)' }));
    }

    // Create protected routers by wrapping with auth middleware
    const protectedAnnotationsRouter = express.Router();
    protectedAnnotationsRouter.use('/annotations', requireAuth);
    protectedAnnotationsRouter.use(createAnnotationsRouter());
    app.use('/api', protectedAnnotationsRouter);

    const protectedReviewsRouter = express.Router();
    protectedReviewsRouter.use('/reviews', requireAuth);
    protectedReviewsRouter.use(createReviewsRouter());
    app.use('/api', protectedReviewsRouter);

    // Access control for docs:
    // - Static HTML pages: client-side nav filtering hides private docs (no server gate)
    // - API endpoints (/api/annotations, /api/reviews): Bearer token auth (requireAuth)
    // - Search API: filters private results for unauthenticated requests
    // - MCP tools: require auth_token for private results
    // Server-side static gating removed — browser navigation doesn't send Bearer headers.
    // TODO: Add cookie-based auth if server-side HTML gating is needed later.

    // Static file serving — serve the Astro build output
    // Mount at /foundry to match Astro's base path, and at / for API/root access
    app.use('/foundry', express.static(STATIC_PATH));
    app.use(express.static(STATIC_PATH));

    // Catch-all fallback for client-side routing — serve index.html for non-API, non-MCP routes
    app.get('*', (req, res) => {
      // Don't catch API or MCP routes
      if (req.path.startsWith('/api/') || req.path.startsWith('/mcp/')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(join(STATIC_PATH, 'index.html'));
    });

    // Global error handler (must be last)
    app.use(errorHandler);

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Foundry API server running on port ${PORT}`);
      console.log(`📊 Health endpoint: http://localhost:${PORT}/api/health`);
      console.log(`📂 Static files: ${STATIC_PATH}`);
      console.log(`🔌 MCP SSE endpoint: http://localhost:${PORT}/mcp/sse`);
      console.log(`📨 MCP message endpoint: http://localhost:${PORT}/mcp/message`);
      console.log(`🌐 CORS enabled for GitHub Pages and localhost`);
      logAuthStatus();
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