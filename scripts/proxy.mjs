/**
 * Foundry Production Proxy
 * 
 * Single entry point on PORT (4321) that:
 * - Routes /api/* and /mcp/* to the Express API server (3001)
 * - Routes everything else through the Astro SSR handler
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Polyfill __dirname and __filename for ESM (Astro's handler may reference them)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
globalThis.__dirname = dirname(fileURLToPath(new URL('../packages/site/dist/server/entry.mjs', import.meta.url)));
globalThis.__filename = fileURLToPath(new URL('../packages/site/dist/server/entry.mjs', import.meta.url));

const { handler } = await import('../packages/site/dist/server/entry.mjs');

const PORT = parseInt(process.env.PORT || '4321', 10);
const API_PORT = 3001;

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // Lightweight health check — responds directly from proxy, never touches Express/Anvil
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: true }));
    return;
  }

  // Route cache invalidation to Astro SSR (it owns the caches)
  if (url.startsWith('/api/invalidate-cache')) {
    handler(req, res);
    return;
  }

  // Route API and MCP requests to the Express backend
  if (url.startsWith('/api/') || url.startsWith('/mcp/')) {
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', (err) => {
      console.error(`[proxy] API request failed: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API server unavailable' }));
    });

    req.pipe(proxyReq, { end: true });
    return;
  }

  // Everything else goes to Astro SSR
  handler(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] Foundry proxy listening on 0.0.0.0:${PORT}`);
  console.log(`[proxy] API routes → 127.0.0.1:${API_PORT}`);
  console.log(`[proxy] All other routes → Astro SSR`);
});
