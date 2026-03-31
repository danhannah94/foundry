import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadAccessMap, getAccessMap, getAccessLevel } from '../access.js';

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

describe('access', () => {
  const mockReadFileSync = vi.mocked(readFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset internal state
    loadAccessMap('/fake/path');
  });

  describe('loadAccessMap', () => {
    it('should load access map from valid JSON file', () => {
      const mockAccessMap = {
        'methodology/': 'public' as const,
        'projects/': 'private' as const,
      };

      mockReadFileSync.mockReturnValue(JSON.stringify(mockAccessMap));

      const result = loadAccessMap('/test/content');

      expect(mockReadFileSync).toHaveBeenCalledWith(
        join('/test/content', '.access.json'),
        'utf-8'
      );
      expect(result).toEqual(mockAccessMap);
      expect(getAccessMap()).toEqual(mockAccessMap);
    });

    it('should handle missing file gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockReadFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = loadAccessMap('/test/content');

      expect(consoleSpy).toHaveBeenCalledWith(
        '⚠️ No .access.json found — all content treated as public'
      );
      expect(result).toEqual({});
      expect(getAccessMap()).toEqual({});

      consoleSpy.mockRestore();
    });

    it('should handle invalid JSON gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockReadFileSync.mockReturnValue('invalid json');

      const result = loadAccessMap('/test/content');

      expect(consoleSpy).toHaveBeenCalledWith(
        '⚠️ No .access.json found — all content treated as public'
      );
      expect(result).toEqual({});
      expect(getAccessMap()).toEqual({});

      consoleSpy.mockRestore();
    });
  });

  describe('getAccessLevel', () => {
    beforeEach(() => {
      const mockAccessMap = {
        'methodology/': 'public' as const,
        'projects/': 'private' as const,
        'projects/public/': 'public' as const,
      };
      mockReadFileSync.mockReturnValue(JSON.stringify(mockAccessMap));
      loadAccessMap('/test/content');
    });

    it('should return public for methodology paths', () => {
      expect(getAccessLevel('methodology/process')).toBe('public');
      expect(getAccessLevel('methodology/tools/anvil')).toBe('public');
    });

    it('should return private for projects paths', () => {
      expect(getAccessLevel('projects/routr/design')).toBe('private');
      expect(getAccessLevel('projects/internal/secret')).toBe('private');
    });

    it('should return public for projects/public paths (longest match)', () => {
      expect(getAccessLevel('projects/public/demo')).toBe('public');
    });

    it('should return public for unknown paths', () => {
      expect(getAccessLevel('unknown/path')).toBe('public');
      expect(getAccessLevel('random')).toBe('public');
    });

    it('should return public for empty path', () => {
      expect(getAccessLevel('')).toBe('public');
    });

    it('should handle exact prefix match without trailing slash', () => {
      expect(getAccessLevel('methodology')).toBe('public');
      expect(getAccessLevel('projects')).toBe('private');
    });

    it('should prefer longer prefix matches', () => {
      // projects/public/ should match before projects/
      expect(getAccessLevel('projects/public/demo')).toBe('public');
      expect(getAccessLevel('projects/private/secret')).toBe('private');
    });
  });

  describe('getAccessMap when no map loaded', () => {
    it('should return empty object when no map is loaded', () => {
      // First reset any existing state by loading an empty map
      mockReadFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      loadAccessMap('/fake/empty/path');
      consoleSpy.mockRestore();

      expect(getAccessMap()).toEqual({});
    });
  });
});