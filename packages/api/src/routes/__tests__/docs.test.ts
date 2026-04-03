import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Anvil } from '@claymore-dev/anvil';
import { AnvilHolder } from '../../anvil-holder.js';
import { createDocsRouter } from '../docs.js';

// Create an AnvilHolder with a mock Anvil pre-loaded
function createReadyHolder(mockAnvil: Anvil): AnvilHolder {
  const holder = new AnvilHolder();
  // Manually set internal state to simulate ready
  (holder as any).anvil = mockAnvil;
  (holder as any)._status = 'ready';
  return holder;
}

// Mock Anvil instance
const createMockAnvil = (): Anvil => ({
  listPages: vi.fn(),
  getPage: vi.fn(),
  getStatus: vi.fn(),
  getSection: vi.fn(),
  // Add any other Anvil methods as needed
} as any);

describe('Docs Router', () => {
  it('should return array of documents for GET /docs', async () => {
    const mockAnvil = createMockAnvil();

    // Mock the listPages response
    vi.mocked(mockAnvil.listPages).mockResolvedValue({
      pages: [
        {
          file_path: 'methodology/process.md',
          title: 'CSDLC Process',
          headings: ['Purpose', 'Overview'],
          chunk_count: 42,
          total_chars: 1500,
          last_modified: '2024-03-15T10:30:00Z',
        },
        {
          file_path: 'api/getting-started.md',
          title: 'Getting Started',
          headings: ['Installation', 'Usage'],
          chunk_count: 15,
          total_chars: 800,
          last_modified: '2024-03-14T09:00:00Z',
        },
      ],
      total_pages: 2,
    });

    const app = express();
    app.use(express.json());
    app.use('/api', createDocsRouter(createReadyHolder(mockAnvil)));

    const response = await request(app)
      .get('/api/docs')
      .expect(200);

    expect(response.body).toEqual([
      {
        path: 'methodology/process.md',
        title: 'CSDLC Process',
        lastModified: '2024-03-15T10:30:00Z',
        chunkCount: 42,
      },
      {
        path: 'api/getting-started.md',
        title: 'Getting Started',
        lastModified: '2024-03-14T09:00:00Z',
        chunkCount: 15,
      },
    ]);

    expect(mockAnvil.listPages).toHaveBeenCalledTimes(1);
  });

  it('should return document with sections for GET /docs/:path', async () => {
    const mockAnvil = createMockAnvil();

    // Mock the getPage response
    vi.mocked(mockAnvil.getPage).mockResolvedValue({
      file_path: 'methodology/process.md',
      title: 'CSDLC Process',
      last_modified: '2024-03-15T10:30:00Z',
      total_chars: 1500,
      chunks: [
        {
          content: 'This document describes the process...',
          heading_path: 'Purpose',
          heading_level: 2,
          char_count: 400,
          ordinal: 0,
        },
        {
          content: 'The overview section covers...',
          heading_path: 'Overview',
          heading_level: 2,
          char_count: 350,
          ordinal: 1,
        },
        {
          content: 'More content under purpose...',
          heading_path: 'Purpose',
          heading_level: 2,
          char_count: 300,
          ordinal: 2,
        },
      ],
    });

    const app = express();
    app.use(express.json());
    app.use('/api', createDocsRouter(createReadyHolder(mockAnvil)));

    const response = await request(app)
      .get('/api/docs/methodology/process.md')
      .expect(200);

    expect(response.body).toEqual({
      path: 'methodology/process.md',
      title: 'CSDLC Process',
      lastModified: '2024-03-15T10:30:00Z',
      sections: [
        {
          heading: 'Purpose',
          level: 2,
          charCount: 700,
          content: 'This document describes the process...\nMore content under purpose...',
        },
        {
          heading: 'Overview',
          level: 2,
          charCount: 350,
          content: 'The overview section covers...',
        },
      ],
    });

    expect(mockAnvil.getPage).toHaveBeenCalledWith('methodology/process.md');
  });

  it('should concatenate chunks with the same heading in ordinal order', async () => {
    const mockAnvil = createMockAnvil();

    vi.mocked(mockAnvil.getPage).mockResolvedValue({
      file_path: 'guide.md',
      title: 'Guide',
      last_modified: '2024-01-01T00:00:00Z',
      total_chars: 600,
      chunks: [
        // Out of ordinal order to verify sorting
        {
          content: 'Third part.',
          heading_path: 'Setup',
          heading_level: 2,
          char_count: 100,
          ordinal: 2,
        },
        {
          content: 'First part.',
          heading_path: 'Setup',
          heading_level: 2,
          char_count: 200,
          ordinal: 0,
        },
        {
          content: 'Second part.',
          heading_path: 'Setup',
          heading_level: 2,
          char_count: 300,
          ordinal: 1,
        },
      ],
    });

    const app = express();
    app.use(express.json());
    app.use('/api', createDocsRouter(createReadyHolder(mockAnvil)));

    const response = await request(app)
      .get('/api/docs/guide.md')
      .expect(200);

    expect(response.body.sections).toEqual([
      {
        heading: 'Setup',
        level: 2,
        charCount: 600,
        content: 'First part.\nSecond part.\nThird part.',
      },
    ]);
  });

  it('should return 404 for non-existent document', async () => {
    const mockAnvil = createMockAnvil();

    // Mock getPage to return null for non-existent file
    vi.mocked(mockAnvil.getPage).mockResolvedValue(null);

    const app = express();
    app.use(express.json());
    app.use('/api', createDocsRouter(createReadyHolder(mockAnvil)));

    const response = await request(app)
      .get('/api/docs/non-existent.md')
      .expect(404);

    expect(response.body).toEqual({
      error: 'Document not found',
    });

    expect(mockAnvil.getPage).toHaveBeenCalledWith('non-existent.md');
  });

  it('should handle anvil.listPages errors gracefully', async () => {
    const mockAnvil = createMockAnvil();

    // Mock listPages to throw an error
    vi.mocked(mockAnvil.listPages).mockRejectedValue(new Error('Anvil error'));

    const app = express();
    app.use(express.json());
    app.use('/api', createDocsRouter(createReadyHolder(mockAnvil)));

    const response = await request(app)
      .get('/api/docs')
      .expect(500);

    expect(response.body).toEqual({
      error: 'Failed to list documents',
    });
  });

  it('should handle anvil.getPage errors gracefully', async () => {
    const mockAnvil = createMockAnvil();

    // Mock getPage to throw an error
    vi.mocked(mockAnvil.getPage).mockRejectedValue(new Error('Anvil error'));

    const app = express();
    app.use(express.json());
    app.use('/api', createDocsRouter(createReadyHolder(mockAnvil)));

    const response = await request(app)
      .get('/api/docs/some-file.md')
      .expect(500);

    expect(response.body).toEqual({
      error: 'Failed to fetch document',
    });
  });

  it('should return 503 with Retry-After when Anvil is initializing', async () => {
    const holder = new AnvilHolder();
    (holder as any)._status = 'initializing';

    const app = express();
    app.use(express.json());
    app.use('/api', createDocsRouter(holder));

    const response = await request(app)
      .get('/api/docs')
      .expect(503);

    expect(response.headers['retry-after']).toBe('5');
    expect(response.body).toEqual({
      status: 'initializing',
      message: 'Search index is loading, please retry',
      retryAfter: 5,
    });
  });

  it('should return 503 when Anvil is unavailable (error state)', async () => {
    const holder = new AnvilHolder();
    (holder as any)._status = 'error';

    const app = express();
    app.use(express.json());
    app.use('/api', createDocsRouter(holder));

    const response = await request(app)
      .get('/api/docs')
      .expect(503);

    expect(response.body).toEqual({ error: 'Service unavailable' });
  });
});
