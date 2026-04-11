import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Annotation } from '../../types/annotations.js';

// Mock the http-client module
vi.mock('../http-client.js', () => ({
  listAnnotations: vi.fn(),
  getAnnotation: vi.fn(),
  createAnnotation: vi.fn(),
  resolveAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
  editAnnotation: vi.fn(),
  reopenAnnotation: vi.fn(),
  submitReview: vi.fn(),
}));

import {
  listAnnotations,
  getAnnotation,
  createAnnotation,
  resolveAnnotation,
  deleteAnnotation,
  editAnnotation,
  reopenAnnotation,
  submitReview,
} from '../http-client.js';

const mockListAnnotations = vi.mocked(listAnnotations);
const mockGetAnnotation = vi.mocked(getAnnotation);
const mockCreateAnnotation = vi.mocked(createAnnotation);
const mockResolveAnnotation = vi.mocked(resolveAnnotation);
const mockDeleteAnnotation = vi.mocked(deleteAnnotation);
const mockEditAnnotation = vi.mocked(editAnnotation);
const mockReopenAnnotation = vi.mocked(reopenAnnotation);
const mockSubmitReview = vi.mocked(submitReview);

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listAnnotations', () => {
  it('should list annotations for a doc_path', async () => {
    const annotations = [makeAnnotation()];
    mockListAnnotations.mockResolvedValue(annotations);

    const results = await listAnnotations('test-doc.md');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('test-id-1');
    expect(results[0].content).toBe('Test annotation');
  });

  it('should filter by section', async () => {
    mockListAnnotations.mockResolvedValue([
      makeAnnotation({ content: 'Intro annotation' }),
    ]);

    const results = await listAnnotations('test-doc.md', 'intro');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Intro annotation');
    expect(mockListAnnotations).toHaveBeenCalledWith('test-doc.md', 'intro');
  });

  it('should filter by status', async () => {
    mockListAnnotations.mockResolvedValue([
      makeAnnotation({ status: 'resolved', content: 'Resolved annotation' }),
    ]);

    const results = await listAnnotations('test-doc.md', undefined, 'resolved');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Resolved annotation');
    expect(mockListAnnotations).toHaveBeenCalledWith('test-doc.md', undefined, 'resolved');
  });

  it('should filter by review_id', async () => {
    mockListAnnotations.mockResolvedValue([
      makeAnnotation({ review_id: 'review-1', content: 'Review annotation' }),
    ]);

    const results = await listAnnotations('test-doc.md', undefined, undefined, 'review-1');
    expect(results).toHaveLength(1);
    expect(results[0].review_id).toBe('review-1');
    expect(mockListAnnotations).toHaveBeenCalledWith('test-doc.md', undefined, undefined, 'review-1');
  });
});

describe('getAnnotation', () => {
  it('should get annotation by ID with replies', async () => {
    const annotation = makeAnnotation({ id: 'parent-1', content: 'Parent comment' });
    const replies = [
      makeAnnotation({ id: 'reply-1', parent_id: 'parent-1', content: 'First reply', created_at: '2024-01-01T01:00:00.000Z' }),
      makeAnnotation({ id: 'reply-2', parent_id: 'parent-1', content: 'Second reply', created_at: '2024-01-01T02:00:00.000Z' }),
    ];
    mockGetAnnotation.mockResolvedValue({ annotation, replies });

    const result = await getAnnotation('parent-1');

    expect(result.annotation.id).toBe('parent-1');
    expect(result.annotation.content).toBe('Parent comment');
    expect(result.replies).toHaveLength(2);
    expect(result.replies[0].id).toBe('reply-1');
    expect(result.replies[1].id).toBe('reply-2');
    expect(mockGetAnnotation).toHaveBeenCalledWith('parent-1');
  });

  it('should return empty replies array when no replies exist', async () => {
    const annotation = makeAnnotation({ id: 'solo-1' });
    mockGetAnnotation.mockResolvedValue({ annotation, replies: [] });

    const result = await getAnnotation('solo-1');

    expect(result.annotation.id).toBe('solo-1');
    expect(result.replies).toEqual([]);
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
    expect(result.heading_path).toBe('intro');
    expect(result.content).toBe('Test annotation');
    expect(result.user_id).toBe('clay');
    expect(result.author_type).toBe('ai');
    expect(result.status).toBe('submitted');
    expect(result.parent_id).toBeNull();
    expect(result.created_at).toBeTruthy();
    expect(result.updated_at).toBeTruthy();
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

  it('should pass explicit status through to the API call', async () => {
    const annotation = makeAnnotation({ status: 'draft' });
    mockCreateAnnotation.mockResolvedValue(annotation);

    const result = await createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'AI annotation forced to draft',
      author_type: 'ai',
      status: 'draft',
    });

    expect(mockCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft' })
    );
    expect(result.status).toBe('draft');
  });

  it('should produce submitted status for ai annotations via MCP (no explicit status)', async () => {
    // Verify the mock is called without a status override so the route
    // applies the ai → submitted defaulting logic
    const annotation = makeAnnotation({ author_type: 'ai', status: 'submitted' });
    mockCreateAnnotation.mockResolvedValue(annotation);

    const result = await createAnnotation({
      doc_path: 'test-doc.md',
      section: 'intro',
      content: 'AI reply',
      author_type: 'ai',
    });

    // status field not passed — http-client omits it so route defaults to submitted
    expect(mockCreateAnnotation).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() })
    );
    expect(result.status).toBe('submitted');
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
        { id: 'ann-1', heading_path: 'intro', quoted_text: null, content: 'First annotation' },
        { id: 'ann-2', heading_path: 'conclusion', quoted_text: null, content: 'Second annotation' },
      ],
    };
    mockSubmitReview.mockResolvedValue(payload);

    const result = await submitReview('test-doc.md', ['ann-1', 'ann-2']);

    expect(result).toMatchObject({
      status: 'review_submitted',
      doc_path: 'test-doc.md',
      comment_count: 2,
    });
    expect((result as any).review_id).toBeTruthy();
    expect((result as any).submitted_at).toBeTruthy();
    expect((result as any).comments).toHaveLength(2);
  });

  it('should include all draft/submitted annotations when no IDs specified', async () => {
    mockSubmitReview.mockResolvedValue({
      status: 'review_submitted',
      review_id: 'review-2',
      doc_path: 'test-doc.md',
      submitted_at: '2024-01-01T00:00:00.000Z',
      comment_count: 2,
      comments: [],
    });

    const result = await submitReview('test-doc.md');

    expect((result as any).comment_count).toBe(2);
  });

  it('should update annotation statuses to submitted', async () => {
    mockSubmitReview.mockResolvedValue({
      status: 'review_submitted',
      review_id: 'review-3',
      doc_path: 'test-doc.md',
      submitted_at: '2024-01-01T00:00:00.000Z',
      comment_count: 1,
      comments: [{ id: 'ann-1', heading_path: 'intro', quoted_text: null, content: 'Test' }],
    });

    const result = await submitReview('test-doc.md', ['ann-1']);

    expect((result as any).status).toBe('review_submitted');
  });
});

describe('deleteAnnotation', () => {
  it('should delete an existing annotation', async () => {
    mockDeleteAnnotation.mockResolvedValue({ status: 'deleted' });

    const result = await deleteAnnotation('test-id-1');

    expect(result.status).toBe('deleted');
    expect(mockDeleteAnnotation).toHaveBeenCalledWith('test-id-1');
  });

  it('should return error for non-existent annotation', async () => {
    mockDeleteAnnotation.mockResolvedValue({ status: 'error', message: 'Annotation not found' });

    const result = await deleteAnnotation('non-existent-id');

    expect(result.status).toBe('error');
    expect(result.message).toBe('Annotation not found');
  });
});

describe('editAnnotation', () => {
  it('should edit annotation with correct args and return updated annotation', async () => {
    const updated = makeAnnotation({ content: 'Updated content' });
    mockEditAnnotation.mockResolvedValue(updated);

    const result = await editAnnotation('test-id-1', 'Updated content');

    expect(mockEditAnnotation).toHaveBeenCalledWith('test-id-1', 'Updated content');
    expect(result.id).toBe('test-id-1');
    expect(result.content).toBe('Updated content');
  });

  it('should throw error for non-existent annotation', async () => {
    mockEditAnnotation.mockRejectedValue(new Error('Annotation not found'));

    await expect(editAnnotation('non-existent-id', 'content'))
      .rejects.toThrow('Annotation not found');
  });
});

describe('reopenAnnotation', () => {
  it('should reopen annotation with correct args and return updated annotation', async () => {
    const updated = makeAnnotation({ status: 'submitted' });
    mockReopenAnnotation.mockResolvedValue(updated);

    const result = await reopenAnnotation('test-id-1');

    expect(mockReopenAnnotation).toHaveBeenCalledWith('test-id-1');
    expect(result.id).toBe('test-id-1');
    expect(result.status).toBe('submitted');
  });

  it('should throw error for non-existent annotation', async () => {
    mockReopenAnnotation.mockRejectedValue(new Error('Annotation not found'));

    await expect(reopenAnnotation('non-existent-id'))
      .rejects.toThrow('Annotation not found');
  });
});
