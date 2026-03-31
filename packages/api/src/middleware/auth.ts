import { Request, Response, NextFunction } from 'express';

/**
 * Check if authentication is enabled (FOUNDRY_WRITE_TOKEN is set)
 */
function isAuthEnabled(): boolean {
  return !!process.env.FOUNDRY_WRITE_TOKEN;
}

/**
 * Bearer token authentication middleware
 *
 * Protects routes by requiring a valid Authorization: Bearer <token> header
 * that matches the FOUNDRY_WRITE_TOKEN environment variable.
 *
 * If FOUNDRY_WRITE_TOKEN is not set, all requests are allowed through (dev mode).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // If auth token is not configured, allow all requests (dev mode)
  if (!isAuthEnabled()) {
    return next();
  }

  const authHeader = req.headers.authorization;

  // Check if Authorization header exists
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Check if header follows Bearer token format
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Extract token from "Bearer <token>" format
  const token = authHeader.slice(7);
  const expectedToken = process.env.FOUNDRY_WRITE_TOKEN;

  // Verify token matches expected value
  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Token is valid, proceed to next middleware/route handler
  next();
}

/**
 * Log authentication status on server startup
 */
export function logAuthStatus(): void {
  if (isAuthEnabled()) {
    console.log('🔒 Authentication enabled for write operations');
  } else {
    console.log('⚠️ Authentication disabled (dev mode) - set FOUNDRY_WRITE_TOKEN to enable');
  }
}