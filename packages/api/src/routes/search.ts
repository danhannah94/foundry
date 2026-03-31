import { Router, Request, Response } from 'express';
import type { Anvil } from '@claymore-dev/anvil';

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
 * Creates the search router
 */
export function createSearchRouter(anvil: Anvil): Router {
  const router = Router();

  router.post('/search', async (req: Request<{}, SearchResponse, SearchRequest>, res: Response<SearchResponse>) => {
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

      const response: SearchResponse = {
        results,
        query,
        totalResults: results.length,
      };

      // Add warning if index appears empty (no results and topK wasn't 0)
      if (results.length === 0 && topK !== 0) {
        response.warning = 'No results found. The Anvil index may be empty or the query did not match any content.';
      }

      res.json(response);
    } catch (error) {
      console.error('Search endpoint error:', error);
      throw error; // Let the global error handler handle it
    }
  });

  return router;
}