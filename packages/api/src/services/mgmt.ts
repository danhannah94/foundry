/**
 * Management service — reindex, status/health, import-repo.
 *
 * These are admin / operational actions that live outside the doc CRUD
 * pipeline proper. Grouped here rather than each getting its own module
 * because they're all short.
 */

import { getDocsPath } from '../config.js';
import { importFromRepo } from '../import.js';
import type { AnvilInstance } from '../anvil-loader.js';
import type { AnvilHolder } from '../anvil-holder.js';
import type { AuthContext } from './context.js';
import { ValidationError, ServiceUnavailableError } from './errors.js';

// ─── reindex ──────────────────────────────────────────────────────────────────

export interface ReindexResult {
  status: 'complete';
  [key: string]: unknown;
}

/**
 * Trigger a full Anvil reindex. Caller passes in the already-resolved
 * AnvilInstance; the route layer handles the 503-on-not-ready path.
 */
export async function reindex(
  _ctx: AuthContext,
  anvil: AnvilInstance,
): Promise<ReindexResult> {
  const result = await anvil.index();
  return { status: 'complete', ...result };
}

// ─── getStatus ────────────────────────────────────────────────────────────────

export interface StatusResult {
  status: 'ok';
  version: string;
  anvil: {
    status: string;
    totalPages?: number;
    totalChunks?: number;
    lastIndexed?: string | null;
    error?: string;
  };
}

/**
 * Health / status probe. Returns the full shape the HTTP handler needs,
 * including the Anvil sub-status. Accepts the AnvilHolder directly since
 * the payload reflects whether Anvil is loading / errored / ready.
 */
export async function getStatus(
  _ctx: AuthContext,
  holder: AnvilHolder,
): Promise<StatusResult> {
  const anvil = holder.get();

  if (anvil) {
    try {
      const status = await anvil.getStatus();
      return {
        status: 'ok',
        version: '0.2.0',
        anvil: {
          status: 'ready',
          totalPages: status.total_pages,
          totalChunks: status.total_chunks,
          lastIndexed: status.last_indexed,
        },
      };
    } catch (error) {
      console.warn('Anvil status error:', error);
      return {
        status: 'ok',
        version: '0.2.0',
        anvil: {
          status: 'ready',
          totalPages: 0,
          totalChunks: 0,
          lastIndexed: null,
        },
      };
    }
  }

  return {
    status: 'ok',
    version: '0.2.0',
    anvil: {
      status: holder.status === 'error' ? 'error' : holder.status,
      ...(holder.error ? { error: holder.error } : {}),
    },
  };
}

// ─── importRepo ───────────────────────────────────────────────────────────────

export interface ImportRepoParams {
  repo: string;
  branch?: string;
  prefix?: string;
}

export async function importRepo(
  _ctx: AuthContext,
  params: ImportRepoParams,
): Promise<{ filesImported: number; docsMetaUpdated: number; duration_ms: number }> {
  const { repo, branch, prefix } = params;

  if (!repo || typeof repo !== 'string') {
    throw new ValidationError('repo is required and must be a string');
  }

  const contentDir = getDocsPath();
  const result = await importFromRepo({
    repoUrl: repo,
    branch: branch || 'main',
    prefix: prefix || 'docs/',
    contentDir,
  });

  // Trigger full Anvil reindex + cache invalidation after import.
  const mod = await import('../index.js');
  await mod.invalidateContent();

  return result;
}

// Re-export helper so route layer can build 503 payloads consistently.
export { ServiceUnavailableError };
