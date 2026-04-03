import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnvilHolder } from '../anvil-holder.js';

// Mock the anvil-loader module
vi.mock('../anvil-loader.js', () => ({
  loadAnvil: vi.fn(),
}));

import { loadAnvil } from '../anvil-loader.js';

const mockLoadAnvil = vi.mocked(loadAnvil);

describe('AnvilHolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in not-started state with null anvil', () => {
    const holder = new AnvilHolder();
    expect(holder.status).toBe('not-started');
    expect(holder.get()).toBeNull();
    expect(holder.isReady()).toBe(false);
    expect(holder.isInitializing()).toBe(false);
    expect(holder.error).toBeNull();
  });

  it('transitions to initializing during init', async () => {
    let resolveInit: (value: any) => void;
    const initPromise = new Promise((resolve) => { resolveInit = resolve; });
    mockLoadAnvil.mockReturnValue(initPromise as any);

    const holder = new AnvilHolder();
    const initP = holder.init('/docs');

    // Should be initializing now
    expect(holder.status).toBe('initializing');
    expect(holder.isInitializing()).toBe(true);
    expect(holder.isReady()).toBe(false);
    expect(holder.get()).toBeNull();

    // Resolve and finish
    resolveInit!({ getStatus: vi.fn() });
    await initP;
  });

  it('transitions to ready when loadAnvil returns an instance', async () => {
    const mockAnvil = { getStatus: vi.fn(), search: vi.fn() };
    mockLoadAnvil.mockResolvedValue(mockAnvil as any);

    const holder = new AnvilHolder();
    await holder.init('/docs');

    expect(holder.status).toBe('ready');
    expect(holder.isReady()).toBe(true);
    expect(holder.isInitializing()).toBe(false);
    expect(holder.get()).toBe(mockAnvil);
    expect(holder.error).toBeNull();
  });

  it('transitions to error when loadAnvil returns null', async () => {
    mockLoadAnvil.mockResolvedValue(null);

    const holder = new AnvilHolder();
    await holder.init('/docs');

    expect(holder.status).toBe('error');
    expect(holder.isReady()).toBe(false);
    expect(holder.isInitializing()).toBe(false);
    expect(holder.get()).toBeNull();
    expect(holder.error).toBe('Anvil not available (not installed or init failed)');
  });

  it('transitions to error when loadAnvil throws', async () => {
    mockLoadAnvil.mockRejectedValue(new Error('Network timeout'));

    const holder = new AnvilHolder();
    await holder.init('/docs');

    expect(holder.status).toBe('error');
    expect(holder.isReady()).toBe(false);
    expect(holder.get()).toBeNull();
    expect(holder.error).toBe('Network timeout');
  });

  it('handles non-Error thrown values', async () => {
    mockLoadAnvil.mockRejectedValue('string error');

    const holder = new AnvilHolder();
    await holder.init('/docs');

    expect(holder.status).toBe('error');
    expect(holder.error).toBe('string error');
  });

  it('passes docsPath to loadAnvil', async () => {
    mockLoadAnvil.mockResolvedValue(null);

    const holder = new AnvilHolder();
    await holder.init('/my/docs/path');

    expect(mockLoadAnvil).toHaveBeenCalledWith('/my/docs/path');
  });
});
