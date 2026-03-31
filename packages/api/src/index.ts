import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createAnvil } from '@claymore-dev/anvil';
import { getDocsPath } from './config.js';
import { createHealthRouter } from './routes/health.js';
import { createDocsRouter } from './routes/docs.js';
import { createSearchRouter } from './routes/search.js';

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

    // Mount health router
    app.use('/', createHealthRouter(anvil));

    // Mount docs router
    app.use('/', createDocsRouter(anvil));

    // Mount search router
    app.use('/', createSearchRouter(anvil));

    // Global error handler (must be last)
    app.use(errorHandler);

    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Foundry API server running on port ${PORT}`);
      console.log(`📊 Health endpoint: http://localhost:${PORT}/health`);
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