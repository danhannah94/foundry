import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the http-client module
vi.mock('../http-client.js', () => ({
  listPages: vi.fn(),
}));

import { listPages } from '../http-client.js';

const mockListPages = vi.mocked(listPages);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPages', () => {
  it('should list public pages by default', async () => {
    const pages = [
      { title: 'Home', path: 'index.md', access: 'public' },
      { title: 'Process', path: 'methodology/process.md', access: 'public' },
    ];
    mockListPages.mockResolvedValue(pages);

    const results = await listPages();
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Home');
    expect(results[0].access).toBe('public');
    expect(mockListPages).toHaveBeenCalledWith();
  });

  it('should list all pages when includePrivate is true', async () => {
    const pages = [
      { title: 'Home', path: 'index.md', access: 'public' },
      { title: 'Design', path: 'projects/foundry/design.md', access: 'private' },
    ];
    mockListPages.mockResolvedValue(pages);

    const results = await listPages(true);
    expect(results).toHaveLength(2);
    expect(results[1].access).toBe('private');
    expect(mockListPages).toHaveBeenCalledWith(true);
  });

  it('should return each page with title, path, and access', async () => {
    const pages = [
      { title: 'Home', path: 'index.md', access: 'public' },
    ];
    mockListPages.mockResolvedValue(pages);

    const results = await listPages();
    expect(results[0]).toHaveProperty('title');
    expect(results[0]).toHaveProperty('path');
    expect(results[0]).toHaveProperty('access');
  });

  it('should return empty array when no pages exist', async () => {
    mockListPages.mockResolvedValue([]);

    const results = await listPages();
    expect(results).toEqual([]);
  });
});
