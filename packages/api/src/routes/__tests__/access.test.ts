import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAccessRouter } from '../access.js';

// Mock the access module
vi.mock('../../access.js', () => ({
  getAccessMap: vi.fn(),
}));

import { getAccessMap } from '../../access.js';

describe('Access Routes', () => {
  let app: express.Application;
  const mockGetAccessMap = vi.mocked(getAccessMap);

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api', createAccessRouter());
  });

  describe('GET /api/access', () => {
    it('should return the access map', async () => {
      const mockAccessMap = {
        'methodology/': 'public' as const,
        'projects/': 'private' as const,
      };

      mockGetAccessMap.mockReturnValue(mockAccessMap);

      const response = await request(app)
        .get('/api/access')
        .expect(200);

      expect(response.body).toEqual(mockAccessMap);
      expect(mockGetAccessMap).toHaveBeenCalledOnce();
    });

    it('should return empty object when no access map is loaded', async () => {
      mockGetAccessMap.mockReturnValue({});

      const response = await request(app)
        .get('/api/access')
        .expect(200);

      expect(response.body).toEqual({});
      expect(mockGetAccessMap).toHaveBeenCalledOnce();
    });

    it('should return consistent data on multiple calls', async () => {
      const mockAccessMap = {
        'docs/': 'public' as const,
        'internal/': 'private' as const,
      };

      mockGetAccessMap.mockReturnValue(mockAccessMap);

      // First request
      const response1 = await request(app)
        .get('/api/access')
        .expect(200);

      // Second request
      const response2 = await request(app)
        .get('/api/access')
        .expect(200);

      expect(response1.body).toEqual(mockAccessMap);
      expect(response2.body).toEqual(mockAccessMap);
      expect(mockGetAccessMap).toHaveBeenCalledTimes(2);
    });
  });
});