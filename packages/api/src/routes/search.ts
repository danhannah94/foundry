import { Router, Request, Response } from 'express';
import type { AnvilHolder } from '../anvil-holder.js';
import { getAccessLevel } from '../access.js';
import { softAuth } from '../middleware/auth.js';

interface SearchRequest {
  query: string;
  topK?: number;
}

interface SearchResponseItem {
  path: string;
  heading: string;
  snippet: string;
  score: number;
  charCount: number;
}

interface SearchResponse {
  results: SearchResponseItem[];
  query: string;
  totalResults: number;
  warning?: string;
}

/**
 * Creates the search router.
 *
 * NOTE: /api/search is the ONE auth-optional route in Foundry. Browsers
 * hit it anonymously (no Bearer header) for the site-wide search UI —
 * that's a product requirement. All other routes either require auth
 * outright (requireAuth) or don't surface access-gated data.
 *
 * Because of this, we use `softAuth` instead of `requireAuth`: it
 * populates req.user when a valid Bearer token is presented, but never
 * 401s on missing/invalid tokens. Private results are filtered in/out
 * based on `req.user?.scopes?.includes('docs:read:private')`.
 *
 * Matrix:
 *   no auth           → public results only, 200
 *   auth, no scope    → public results only, 200
 *   auth, with scope  → all results, 200
 *   invalid token     → public results only, 200 (treated as anonymous)
 */
export function createSearchRouter(holder: AnvilHolder): Router {
  const router = Router();

  router.post('/search', softAuth, async (req: Request<{}, SearchResponse, SearchRequest>, res: Response<SearchResponse>) => {
    const anvil = holder.get();

    if (!anvil) {
      if (holder.isInitializing()) {
        res.set('Retry-After', '5');
        return res.status(503).json({
          status: 'initializing',
          message: 'Search index is loading, please retry',
          retryAfter: 5,
        } as any);
      }
      return res.status(503).json({ error: 'Service unavailable' } as any);
    }

    try {
      const { query, topK = 10 } = req.body;

      // Validate request body
      if (typeof query !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid "query" field. Expected a non-empty string.',
        } as any);
      }

      if (query.trim() === '') {
        return res.status(400).json({
          error: 'Query cannot be an empty string.',
        } as any);
      }

      // Check if index has content before searching (empty vss index crashes FAISS)
      const status = await anvil.getStatus();
      if (status.total_chunks === 0) {
        return res.json({
          results: [],
          query,
          totalResults: 0,
          warning: 'Anvil index is empty. Run anvil index to populate.',
        } as SearchResponse);
      }

      // Call anvil search
      const searchResults = await anvil.search(query, topK);

      // Transform results to the required format
      const results: SearchResponseItem[] = searchResults.map(result => ({
        path: result.metadata.file_path,
        heading: result.metadata.heading_path,
        snippet: result.content.slice(0, 200),
        score: result.score,
        charCount: result.metadata.char_count,
      }));

      // Scope-aware filter: include private docs only if the caller's token
      // carries `docs:read:private`. Missing/invalid tokens → req.user is
      // undefined → public-only. Legacy FOUNDRY_WRITE_TOKEN inherits all
      // three docs scopes (set in middleware/auth.ts LEGACY_SCOPES) and
      // passes this check.
      const canReadPrivate = req.user?.scopes?.includes('docs:read:private') ?? false;
      const accessFiltered = canReadPrivate
        ? results
        : results.filter(r => getAccessLevel(r.path) !== 'private');

      // Filter out low-relevance results
      const MIN_RELEVANCE_SCORE = 0.5;
      const filteredResults = accessFiltered.filter(r => r.score >= MIN_RELEVANCE_SCORE);

      const response: SearchResponse = {
        results: filteredResults,
        query,
        totalResults: filteredResults.length,
      };

      // Add warning if index appears empty (no results and topK wasn't 0)
      if (filteredResults.length === 0 && topK !== 0) {
        response.warning = 'No results matched your query.';
      }

      res.json(response);
    } catch (error) {
      console.error('Search endpoint error:', error);
      throw error; // Let the global error handler handle it
    }
  });

  return router;
}
