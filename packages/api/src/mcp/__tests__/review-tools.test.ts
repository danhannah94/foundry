import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Annotation, Review } from '../../types/annotations.js';

// Mock the http-client module
vi.mock('../http-client.js', () => ({
  listReviews: vi.fn(),
  getReview: vi.fn(),
}));

import { listReviews, getReview } from '../http-client.js';

const mockListReviews = vi.mocked(listReviews);
const mockGetReview = vi.mocked(getReview);

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'review-1',
    doc_path: 'test-doc.md',
    user_id: 'dan',
    status: 'draft',
    submitted_at: null,
    completed_at: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'test-id-1',
    doc_path: 'test-doc.md',
    heading_path: 'intro',
    content_hash: '',
    quoted_text: null,
    content: 'Test annotation',
    parent_id: null,
    review_id: 'review-1',
    user_id: 'dan',
    author_type: 'human',
    status: 'submitted',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listReviews', () => {
  it('should list reviews for a doc_path', async () => {
    const reviews = [makeReview()];
    mockListReviews.mockResolvedValue(reviews);

    const results = await listReviews('test-doc.md');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('review-1');
    expect(results[0].doc_path).toBe('test-doc.md');
    expect(mockListReviews).toHaveBeenCalledWith('test-doc.md');
  });

  it('should filter by status', async () => {
    mockListReviews.mockResolvedValue([
      makeReview({ status: 'submitted' }),
    ]);

    const results = await listReviews('test-doc.md', 'submitted');
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('submitted');
    expect(mockListReviews).toHaveBeenCalledWith('test-doc.md', 'submitted');
  });

  it('should return empty array when no reviews exist', async () => {
    mockListReviews.mockResolvedValue([]);

    const results = await listReviews('empty-doc.md');
    expect(results).toEqual([]);
  });
});

describe('getReview', () => {
  it('should get review by ID with annotations', async () => {
    const review = makeReview({ id: 'review-1' });
    const annotations = [
      makeAnnotation({ id: 'ann-1', content: 'First comment', created_at: '2024-01-01T01:00:00.000Z' }),
      makeAnnotation({ id: 'ann-2', content: 'Second comment', created_at: '2024-01-01T02:00:00.000Z' }),
    ];
    mockGetReview.mockResolvedValue({ review, annotations });

    const result = await getReview('review-1');

    expect(result.review.id).toBe('review-1');
    expect(result.review.doc_path).toBe('test-doc.md');
    expect(result.annotations).toHaveLength(2);
    expect(result.annotations[0].id).toBe('ann-1');
    expect(result.annotations[1].id).toBe('ann-2');
    expect(mockGetReview).toHaveBeenCalledWith('review-1');
  });

  it('should return empty annotations array when no annotations exist', async () => {
    const review = makeReview({ id: 'review-2' });
    mockGetReview.mockResolvedValue({ review, annotations: [] });

    const result = await getReview('review-2');

    expect(result.review.id).toBe('review-2');
    expect(result.annotations).toEqual([]);
  });
});
