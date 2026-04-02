import type { APIRoute } from 'astro';
import { getCacheStats } from '../../utils/page-cache';

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(getCacheStats()), {
    headers: { 'Content-Type': 'application/json' }
  });
};
