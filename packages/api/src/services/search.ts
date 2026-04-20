/**
 * Search service — transport-agnostic semantic-search business logic.
 *
 * This is the one service that's auth-aware at the domain layer:
 * private-doc filtering depends on the caller's scopes (D-S8-5 / S9).
 * When ctx.user is undefined OR lacks `docs:read:private`, results are
 * filtered to public-only.
 *
 * Anvil readiness is the caller's responsibility — they pass in the
 * already-resolved AnvilInstance. The route layer handles the 503 / init
 * path; the service expects anvil to be ready by the time it runs.
 */

import type { AnvilInstance } from '../anvil-loader.js';
import { getAccessLevel } from '../access.js';
import type { AuthContext } from './context.js';
import { ValidationError, ServiceUnavailableError } from './errors.js';

export interface SearchParams {
  query: string;
  topK?: number;
}

export interface SearchResultItem {
  path: string;
  heading: string;
  snippet: string;
  score: number;
  charCount: number;
}

export interface SearchResult {
  results: SearchResultItem[];
  query: string;
  totalResults: number;
  warning?: string;
}

const MIN_RELEVANCE_SCORE = 0.5;

export async function search(
  ctx: AuthContext,
  anvil: AnvilInstance,
  params: SearchParams,
): Promise<SearchResult> {
  const { query, topK = 10 } = params;

  if (typeof query !== 'string') {
    throw new ValidationError('Missing or invalid "query" field. Expected a non-empty string.');
  }

  if (query.trim() === '') {
    throw new ValidationError('Query cannot be an empty string.');
  }

  // Empty index short-circuit (FAISS crashes on empty vss queries).
  const status = await anvil.getStatus();
  if (status.total_chunks === 0) {
    return {
      results: [],
      query,
      totalResults: 0,
      warning: 'Anvil index is empty. Run anvil index to populate.',
    };
  }

  const searchResults = await anvil.search(query, topK);

  const mapped: SearchResultItem[] = searchResults.map(result => ({
    path: result.metadata.file_path,
    heading: result.metadata.heading_path,
    snippet: result.content.slice(0, 200),
    score: result.score,
    charCount: result.metadata.char_count,
  }));

  // Scope-aware access filter. Missing/invalid tokens → ctx.user undefined
  // → public-only. Legacy FOUNDRY_WRITE_TOKEN carries all docs:read:* scopes
  // (see middleware/auth.ts LEGACY_SCOPES) and passes this check.
  const canReadPrivate = ctx.user?.scopes?.includes('docs:read:private') ?? false;
  const accessFiltered = canReadPrivate
    ? mapped
    : mapped.filter(r => getAccessLevel(r.path) !== 'private');

  const filteredResults = accessFiltered.filter(r => r.score >= MIN_RELEVANCE_SCORE);

  const result: SearchResult = {
    results: filteredResults,
    query,
    totalResults: filteredResults.length,
  };

  if (filteredResults.length === 0 && topK !== 0) {
    result.warning = 'No results matched your query.';
  }

  return result;
}

// Re-export so tests don't have to reach into errors.ts for this.
export { ServiceUnavailableError };
