import type { Annotation, Review } from '../types/annotations.js';

const BASE_URL = process.env.FOUNDRY_API_URL || 'http://localhost:3001';
const WRITE_TOKEN = () => process.env.FOUNDRY_WRITE_TOKEN || '';

function authHeaders(): Record<string, string> {
  const token = WRITE_TOKEN();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Error thrown when an API call fails. Preserves the parsed JSON body so
 * callers can access structured fields like `available_headings` on 404s.
 */
export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(status: number, method: string, path: string, payload: any) {
    const payloadStr =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    super(`API ${method} ${path} failed (${status}): ${payloadStr}`);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
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
    const raw = await res.text();
    let parsed: any = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // not JSON — keep as string
    }
    throw new ApiError(res.status, options.method || 'GET', path, parsed);
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
  reviewId?: string,
): Promise<Annotation[]> {
  const params = new URLSearchParams({ doc_path: docPath });
  if (section) params.set('section', section);
  if (status) params.set('status', status);
  if (reviewId) params.set('review_id', reviewId);
  return apiFetch<Annotation[]>(`/api/annotations?${params}`);
}

/**
 * Get a single annotation by ID, including its reply thread.
 */
export async function getAnnotation(
  annotationId: string,
): Promise<{ annotation: Annotation; replies: Annotation[] }> {
  return apiFetch<{ annotation: Annotation; replies: Annotation[] }>(`/api/annotations/${annotationId}`);
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
  quoted_text?: string;
}): Promise<Annotation> {
  return apiFetch<Annotation>('/api/annotations', {
    method: 'POST',
    body: JSON.stringify({
      doc_path: params.doc_path,
      heading_path: params.section,
      content: params.content,
      parent_id: params.parent_id || undefined,
      quoted_text: params.quoted_text || undefined,
      author_type: params.author_type || 'ai',
      user_id: process.env.FOUNDRY_MCP_USER || 'clay',
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
  // 1. Create review (attribute to configured MCP user instead of "anonymous")
  const review = await apiFetch<{ id: string; doc_path: string }>('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({
      doc_path: docPath,
      user_id: process.env.FOUNDRY_MCP_USER || 'clay',
    }),
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
 * Reopen a previously resolved annotation by setting status back to "draft".
 */
export async function reopenAnnotation(
  annotationId: string,
): Promise<Annotation> {
  try {
    return await apiFetch<Annotation>(`/api/annotations/${annotationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draft' }),
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
 * List reviews for a document, optionally filtered by status.
 */
export async function listReviews(
  docPath: string,
  status?: string,
): Promise<Review[]> {
  const params = new URLSearchParams({ doc_path: docPath });
  if (status) params.set('status', status);
  return apiFetch<Review[]>(`/api/reviews?${params}`);
}

/**
 * Get a single review by ID, including its annotations.
 */
export async function getReview(
  reviewId: string,
): Promise<{ review: Review; annotations: Annotation[] }> {
  return apiFetch<{ review: Review; annotations: Annotation[] }>(`/api/reviews/${reviewId}`);
}

/**
 * List pages from the navigation tree.
 */
export async function listPages(
  includePrivate?: boolean,
): Promise<Array<{ title: string; path: string; access: string }>> {
  const params = new URLSearchParams();
  if (includePrivate) params.set('include_private', 'true');
  const qs = params.toString();
  return apiFetch<Array<{ title: string; path: string; access: string }>>(
    `/api/pages${qs ? `?${qs}` : ''}`,
  );
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
 * Get a single page by path.
 */
export async function getPage(
  path: string,
): Promise<object> {
  return apiFetch<object>(`/api/docs/${path}`);
}

/**
 * Get a specific section from a document.
 */
export async function getSection(
  path: string,
  headingPath: string,
): Promise<object> {
  return apiFetch<object>(`/api/docs/${path}/sections/${encodeURIComponent(headingPath)}`);
}

/**
 * Get server health/status.
 */
export async function getStatus(): Promise<object> {
  return apiFetch<object>('/api/health');
}

/**
 * Trigger a full reindex of documentation.
 */
export async function reindex(): Promise<object> {
  return apiFetch<object>('/api/reindex', { method: 'POST' });
}

/**
 * Import a repo into the Foundry content directory.
 */
export async function importRepo(
  repo: string,
  branch?: string,
  prefix?: string,
): Promise<{ filesImported: number; docsMetaUpdated: number; duration_ms: number }> {
  return apiFetch<{ filesImported: number; docsMetaUpdated: number; duration_ms: number }>('/api/import', {
    method: 'POST',
    body: JSON.stringify({ repo, branch, prefix }),
  });
}

/**
 * Create a new document from a template.
 */
export async function createDoc(
  path: string,
  template: string,
  title?: string,
): Promise<object> {
  return apiFetch<object>('/api/docs', {
    method: 'POST',
    body: JSON.stringify({ path, template, title }),
  });
}

/**
 * Update a section's body content by heading path.
 *
 * @param docPath Document path (no .md extension)
 * @param headingPath Canonical heading path in the form
 *   "## Parent > ### Child" (`#` prefix on every level, separated by ` > `).
 * @param content New body content (markdown, NOT including the heading line)
 * @throws ApiError with status 404 and payload.available_headings on no-match.
 */
export async function updateSection(
  docPath: string,
  headingPath: string,
  content: string,
): Promise<object> {
  return apiFetch<object>(
    `/api/docs/${docPath}/sections/${encodeURIComponent(headingPath)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ content }),
    },
  );
}

/**
 * Insert a new section after an existing heading.
 *
 * @param docPath Document path (no .md extension)
 * @param afterHeadingPath Canonical heading path of the section to insert
 *   after, e.g. "## Architecture > ### Tech Stack".
 * @param heading New section heading text (without `#` prefix — level is
 *   passed separately).
 * @param level Heading level (1–6) for the new section.
 * @param content New section body content.
 * @throws ApiError with status 404 and payload.available_headings on no-match.
 */
export async function insertSection(
  docPath: string,
  afterHeadingPath: string,
  heading: string,
  level: number,
  content: string,
): Promise<object> {
  return apiFetch<object>(
    `/api/docs/${docPath}/sections`,
    {
      method: 'POST',
      body: JSON.stringify({ after_heading: afterHeadingPath, heading, level, content }),
    },
  );
}

/**
 * Delete a section by heading path.
 *
 * @param docPath Document path (no .md extension)
 * @param headingPath Canonical heading path of the section to delete.
 * @throws ApiError with status 404 and payload.available_headings on no-match.
 */
export async function deleteSection(
  docPath: string,
  headingPath: string,
): Promise<object> {
  return apiFetch<object>(
    `/api/docs/${docPath}/sections/${encodeURIComponent(headingPath)}`,
    {
      method: 'DELETE',
    },
  );
}

/**
 * Hard-delete an entire document. Removes the file, docs_meta row, and all
 * annotations for the doc. Not recoverable.
 *
 * @param docPath Document path (no .md extension)
 * @throws ApiError with status 404 if the document does not exist.
 */
export async function deleteDoc(docPath: string): Promise<object> {
  return apiFetch<object>(`/api/docs/${docPath}`, {
    method: 'DELETE',
  });
}

/**
 * Push content to a configured GitHub repo as a backup.
 */
export async function syncToGithub(
  remote?: string,
  branch?: string,
): Promise<{ filesSync: number; commitHash: string; duration_ms: number }> {
  return apiFetch<{ filesSync: number; commitHash: string; duration_ms: number }>('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ remote, branch }),
  });
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
