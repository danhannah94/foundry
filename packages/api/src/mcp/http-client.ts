import type { Annotation } from '../types/annotations.js';

const BASE_URL = process.env.FOUNDRY_API_URL || 'http://localhost:3001';
const WRITE_TOKEN = () => process.env.FOUNDRY_WRITE_TOKEN || '';

function authHeaders(): Record<string, string> {
  const token = WRITE_TOKEN();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${options.method || 'GET'} ${path} failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

/**
 * List annotations for a document, optionally filtered by section/status.
 */
export async function listAnnotations(
  docPath: string,
  section?: string,
  status?: string,
): Promise<Annotation[]> {
  const params = new URLSearchParams({ doc_path: docPath });
  if (section) params.set('section', section);
  if (status) params.set('status', status);
  return apiFetch<Annotation[]>(`/api/annotations?${params}`);
}

/**
 * Create an annotation via HTTP API.
 */
export async function createAnnotation(params: {
  doc_path: string;
  section: string;
  content: string;
  parent_id?: string;
  author_type?: string;
}): Promise<Annotation> {
  return apiFetch<Annotation>('/api/annotations', {
    method: 'POST',
    body: JSON.stringify({
      doc_path: params.doc_path,
      heading_path: params.section,
      content: params.content,
      parent_id: params.parent_id || undefined,
      author_type: params.author_type || 'ai',
      user_id: 'clay',
      status: params.parent_id ? 'replied' : 'submitted',
    }),
  });
}

/**
 * Resolve an annotation by setting status to "resolved".
 */
export async function resolveAnnotation(
  annotationId: string,
): Promise<{ status: string; annotation_id?: string; message?: string }> {
  try {
    const updated = await apiFetch<Annotation>(`/api/annotations/${annotationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' }),
    });
    return { status: 'resolved', annotation_id: updated.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404')) {
      return { status: 'error', message: 'Annotation not found' };
    }
    throw err;
  }
}

/**
 * Submit a review batch:
 * 1. POST /api/reviews to create review record
 * 2. PATCH each annotation with review_id + status
 * 3. PATCH review to submitted
 */
export async function submitReview(
  docPath: string,
  annotationIds?: string[],
): Promise<object> {
  // 1. Create review
  const review = await apiFetch<{ id: string; doc_path: string }>('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({ doc_path: docPath }),
  });

  // Get annotations to include
  let annotations: Annotation[];
  if (annotationIds && annotationIds.length > 0) {
    // Fetch each specified annotation
    const all = await listAnnotations(docPath);
    annotations = all.filter(a => annotationIds.includes(a.id));
  } else {
    // Default: all draft/submitted annotations for this doc
    const drafts = await listAnnotations(docPath, undefined, 'draft');
    const submitted = await listAnnotations(docPath, undefined, 'submitted');
    annotations = [...drafts, ...submitted];
  }

  const now = new Date().toISOString();

  // 2. Update each annotation with review_id and status
  for (const ann of annotations) {
    await apiFetch(`/api/annotations/${ann.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ review_id: review.id, status: 'submitted' }),
    });
  }

  // 3. Mark review as submitted
  await apiFetch(`/api/reviews/${review.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'submitted', submitted_at: now }),
  });

  return {
    status: 'review_submitted',
    review_id: review.id,
    doc_path: docPath,
    submitted_at: now,
    comment_count: annotations.length,
    comments: annotations.map(a => ({
      id: a.id,
      heading_path: a.heading_path,
      quoted_text: a.quoted_text,
      content: a.content,
    })),
  };
}

/**
 * Delete an annotation by ID. Cascade-deletes child replies and cleans up orphan reviews.
 */
export async function deleteAnnotation(
  annotationId: string,
): Promise<{ status: 'deleted' | 'error'; message?: string }> {
  const url = `${BASE_URL}/api/annotations/${annotationId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...authHeaders(),
    },
  });

  if (res.status === 204) {
    return { status: 'deleted' };
  }

  if (res.status === 404) {
    return { status: 'error', message: 'Annotation not found' };
  }

  const body = await res.text();
  throw new Error(`API DELETE /api/annotations/${annotationId} failed (${res.status}): ${body}`);
}

/**
 * Edit the content of an existing annotation.
 */
export async function editAnnotation(
  annotationId: string,
  content: string,
): Promise<Annotation> {
  try {
    return await apiFetch<Annotation>(`/api/annotations/${annotationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404')) {
      throw new Error('Annotation not found');
    }
    throw err;
  }
}

/**
 * Reopen a previously resolved annotation by setting status back to "submitted".
 */
export async function reopenAnnotation(
  annotationId: string,
): Promise<Annotation> {
  try {
    return await apiFetch<Annotation>(`/api/annotations/${annotationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'submitted' }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('404')) {
      throw new Error('Annotation not found');
    }
    throw err;
  }
}

interface SearchResult {
  path: string;
  heading: string;
  snippet: string;
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalResults: number;
  warning?: string;
}

/**
 * Semantic search via HTTP API.
 */
export async function searchDocs(
  query: string,
  topK: number = 10,
  authToken?: string,
): Promise<SearchResponse> {
  const headers: Record<string, string> = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  return apiFetch<SearchResponse>('/api/search', {
    method: 'POST',
    body: JSON.stringify({ query, topK }),
    headers,
  });
}
