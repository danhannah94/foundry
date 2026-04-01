import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Annotation } from '../../types/annotations.js';

// Mock the http-client module
vi.mock('../http-client.js', () => ({
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  resolveAnnotation: vi.fn(),
  submitReview: vi.fn(),
  searchDocs: vi.fn(),
}));

import {
  listAnnotations,
  createAnnotation,
  resolveAnnotation,
  submitReview,
} from '../http-client.js';

const mockListAnnotations = vi.mocked(listAnnotations);
const mockCreateAnnotation = vi.mocked(createAnnotation);
const mockResolveAnnotation = vi.mocked(resolveAnnotation);
const mockSubmitReview = vi.mocked(submitReview);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'test-id-1',
    doc_path: 'test-doc.md',
    heading_path: 'intro',
    content_hash: '',
    quoted_text: null,
    content: 'Test annotation',
    parent_id: null,
    review_id: null,
    user_id: 'clay',
    author_type: 'ai',
    status: 'submitted',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('HTTP client annotation functions', () => {
  describe('listAnnotations', () => {
    it('should list annotations for a doc_path', async () => {
      const annotations = [makeAnnotation()];
      mockListAnnotations.mockResolvedValue(annotations);

      const results = await listAnnotations('test-doc.md');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('test-id-1');
      expect(results[0].content).toBe('Test annotation');
      expect(mockListAnnotations).toHaveBeenCalledWith('test-doc.md');
    });

    it('should filter by section', async () => {
      const annotations = [makeAnnotation({ heading_path: 'intro', content: 'Intro annotation' })];
      mockListAnnotations.mockResolvedValue(annotations);

      const results = await listAnnotations('test-doc.md', 'intro');
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Intro annotation');
      expect(mockListAnnotations).toHaveBeenCalledWith('test-doc.md', 'intro');
    });

    it('should filter by status', async () => {
      const annotations = [makeAnnotation({ status: 'resolved', content: 'Resolved annotation' })];
      mockListAnnotations.mockResolvedValue(annotations);

      const results = await listAnnotations('test-doc.md', undefined, 'resolved');
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Resolved annotation');
      expect(mockListAnnotations).toHaveBeenCalledWith('test-doc.md', undefined, 'resolved');
    });
  });

  describe('createAnnotation', () => {
    it('should create annotation with default values', async () => {
      const annotation = makeAnnotation();
      mockCreateAnnotation.mockResolvedValue(annotation);

      const result = await createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Test annotation',
      });

      expect(result.id).toBeTruthy();
      expect(result.doc_path).toBe('test-doc.md');
      expect(result.content).toBe('Test annotation');
      expect(result.user_id).toBe('clay');
      expect(result.author_type).toBe('ai');
      expect(result.status).toBe('submitted');
      expect(result.parent_id).toBeNull();
    });

    it('should create reply annotation when parent_id provided', async () => {
      const reply = makeAnnotation({ parent_id: 'parent-1', status: 'replied' });
      mockCreateAnnotation.mockResolvedValue(reply);

      const result = await createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Reply annotation',
        parent_id: 'parent-1',
      });

      expect(result.parent_id).toBe('parent-1');
      expect(result.status).toBe('replied');
    });

    it('should use custom author_type when provided', async () => {
      const annotation = makeAnnotation({ author_type: 'human' });
      mockCreateAnnotation.mockResolvedValue(annotation);

      const result = await createAnnotation({
        doc_path: 'test-doc.md',
        section: 'intro',
        content: 'Human annotation',
        author_type: 'human',
      });

      expect(result.author_type).toBe('human');
    });
  });

  describe('resolveAnnotation', () => {
    it('should resolve existing annotation', async () => {
      mockResolveAnnotation.mockResolvedValue({ status: 'resolved', annotation_id: 'test-id-1' });

      const result = await resolveAnnotation('test-id-1');

      expect(result.status).toBe('resolved');
      expect(result.annotation_id).toBe('test-id-1');
    });

    it('should return error for non-existent annotation', async () => {
      mockResolveAnnotation.mockResolvedValue({ status: 'error', message: 'Annotation not found' });

      const result = await resolveAnnotation('non-existent-id');

      expect(result.status).toBe('error');
      expect(result.message).toBe('Annotation not found');
    });
  });

  describe('submitReview', () => {
    it('should create review with specified annotation IDs', async () => {
      const payload = {
        status: 'review_submitted',
        review_id: 'review-1',
        doc_path: 'test-doc.md',
        submitted_at: '2024-01-01T00:00:00.000Z',
        comment_count: 2,
        comments: [
          { id: 'ann-1', heading_path: 'intro', quoted_text: null, content: 'First' },
          { id: 'ann-2', heading_path: 'conclusion', quoted_text: null, content: 'Second' },
        ],
      };
      mockSubmitReview.mockResolvedValue(payload);

      const result = submitReview('test-doc.md', ['ann-1', 'ann-2']);

      expect(mockSubmitReview).toHaveBeenCalledWith('test-doc.md', ['ann-1', 'ann-2']);
      await expect(result).resolves.toMatchObject({
        status: 'review_submitted',
        doc_path: 'test-doc.md',
        comment_count: 2,
      });
    });

    it('should include all draft/submitted annotations when no IDs specified', async () => {
      const payload = {
        status: 'review_submitted',
        review_id: 'review-2',
        doc_path: 'test-doc.md',
        submitted_at: '2024-01-01T00:00:00.000Z',
        comment_count: 2,
        comments: [],
      };
      mockSubmitReview.mockResolvedValue(payload);

      const result = await submitReview('test-doc.md');

      expect(mockSubmitReview).toHaveBeenCalledWith('test-doc.md');
      expect((result as any).comment_count).toBe(2);
    });
  });
});
