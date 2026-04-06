import type { APIRoute } from 'astro';
import { invalidateAll } from '../../utils/page-cache';
import { invalidateNav } from '../../utils/nav';

export const POST: APIRoute = ({ request }) => {
  // Only allow internal calls (from the API server via proxy)
  // The proxy runs on localhost, so we check for internal origin
  const secret = request.headers.get('x-internal-secret');
  if (secret !== (process.env.CACHE_INVALIDATION_SECRET || 'foundry-internal')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  invalidateAll();
  invalidateNav();

  return new Response(JSON.stringify({
    status: 'ok',
    message: 'Page cache and nav cache invalidated',
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
