import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createAnvil } from '@claymore-dev/anvil';
import { getDocsPath } from './config.js';
import { createHealthRouter } from './routes/health.js';
import { createDocsRouter } from './routes/docs.js';
import { createSearchRouter } from './routes/search.js';
import { createAnnotationsRouter } from './routes/annotations.js';
import { createReviewsRouter } from './routes/reviews.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from './mcp/server.js';

// Environment configuration
const PORT = process.env.FOUNDRY_PORT ? parseInt(process.env.FOUNDRY_PORT, 10) : 3001;

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

    // Initialize Anvil with the configured docs path
    console.log('🔧 Initializing Anvil...');
    const anvil = await createAnvil({ docsPath });
    console.log('✅ Anvil initialized successfully');

    // Create MCP server
    console.log('🔧 Initializing MCP server...');
    const mcpServer = createMcpServer(anvil);
    console.log('✅ MCP server initialized successfully');

    // Store active SSE transports
    const transports = new Map<string, SSEServerTransport>();

    // MCP SSE endpoints
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

    // Mount health router
    app.use('/api', createHealthRouter(anvil));

    // Mount docs router
    app.use('/api', createDocsRouter(anvil));

    // Mount search router
    app.use('/api', createSearchRouter(anvil));

    // Mount annotations router
    app.use('/api', createAnnotationsRouter());

    // Mount reviews router
    app.use('/api', createReviewsRouter());

    // Global error handler (must be last)
    app.use(errorHandler);

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Foundry API server running on port ${PORT}`);
      console.log(`📊 Health endpoint: http://localhost:${PORT}/api/health`);
      console.log(`🔌 MCP SSE endpoint: http://localhost:${PORT}/mcp/sse`);
      console.log(`📨 MCP message endpoint: http://localhost:${PORT}/mcp/message`);
      console.log(`🌐 CORS enabled for GitHub Pages and localhost`);
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