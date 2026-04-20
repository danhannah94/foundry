/**
 * Service-level unit tests for mgmtService.
 *
 * Focus: getStatus handles the three AnvilHolder states (ready /
 * initializing / error); reindex delegates to anvil.index();
 * importRepo validates inputs.
 */

import { describe, it, expect, vi } from 'vitest';
import * as mgmtService from '../mgmt.js';
import { ValidationError } from '../errors.js';
import type { AuthContext } from '../context.js';

const ctx: AuthContext = {};

describe('mgmtService.reindex', () => {
  it('delegates to anvil.index and stamps status=complete', async () => {
    const anvil: any = {
      index: vi.fn(async () => ({ indexed: 42 })),
    };
    const result = await mgmtService.reindex(ctx, anvil);
    expect(result.status).toBe('complete');
    expect(result.indexed).toBe(42);
    expect(anvil.index).toHaveBeenCalled();
  });
});

describe('mgmtService.getStatus', () => {
  it('returns "ready" shape when Anvil is healthy', async () => {
    const holder: any = {
      get: () => ({
        getStatus: vi.fn(async () => ({
          total_pages: 10,
          total_chunks: 100,
          last_indexed: '2024-01-01T00:00:00Z',
        })),
      }),
      status: 'ready',
      error: null,
    };
    const result = await mgmtService.getStatus(ctx, holder);
    expect(result.anvil.status).toBe('ready');
    expect(result.anvil.totalPages).toBe(10);
    expect(result.anvil.totalChunks).toBe(100);
  });

  it('degrades to zero-count when anvil.getStatus throws', async () => {
    const holder: any = {
      get: () => ({
        getStatus: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
      status: 'ready',
      error: null,
    };
    const result = await mgmtService.getStatus(ctx, holder);
    expect(result.anvil.status).toBe('ready');
    expect(result.anvil.totalPages).toBe(0);
    expect(result.anvil.lastIndexed).toBeNull();
  });

  it('forwards initializing / error state from holder', async () => {
    const holderInit: any = {
      get: () => null,
      status: 'initializing',
      error: null,
    };
    const initResult = await mgmtService.getStatus(ctx, holderInit);
    expect(initResult.anvil.status).toBe('initializing');

    const holderErr: any = {
      get: () => null,
      status: 'error',
      error: 'kaboom',
    };
    const errResult = await mgmtService.getStatus(ctx, holderErr);
    expect(errResult.anvil.status).toBe('error');
    expect(errResult.anvil.error).toBe('kaboom');
  });
});

describe('mgmtService.importRepo', () => {
  it('validates that repo is provided', async () => {
    await expect(
      mgmtService.importRepo(ctx, { repo: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('validates that repo is a string', async () => {
    await expect(
      mgmtService.importRepo(ctx, { repo: 123 as any }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
