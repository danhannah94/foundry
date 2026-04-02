import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch, isAuthenticated } from '../utils/api.js';
import { getCleanHeadingText } from '../utils/heading-text.js';
import { getDrafts, clearDrafts, type DraftComment } from '../utils/draft-storage.js';

// Types (copied from API package)
type AnnotationStatus = "draft" | "submitted" | "replied" | "resolved" | "orphaned";
type AuthorType = "human" | "ai";

interface Annotation {
  id: string;
  doc_path: string;
  heading_path: string;
  content_hash: string;
  quoted_text: string | null;
  content: string;
  parent_id: string | null;
  review_id: string | null;
  user_id: string;
  author_type: AuthorType;
  status: AnnotationStatus;
  created_at: string;
  updated_at: string;
}

interface ReviewGroup {
  review_id: string;
  annotations: Annotation[];
}

interface Props {
  docPath: string;
}

const STORAGE_KEY = 'foundry-thread-panel';

// Utility function for relative timestamps
function relativeTime(isoString: string): string {
  const now = new Date();
  const date = new Date(isoString);
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  // For older dates, show month/day
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Status icon helper
function getStatusIcon(status: AnnotationStatus, hasReplies: boolean = false): string {
  switch (status) {
    case 'draft': return '💬';
    case 'submitted': return '💬';
    case 'replied': return hasReplies ? '💬' : '💬';
    case 'resolved': return '✅';
    case 'orphaned': return '⚠️';
    default: return '💬';
  }
}

// Author badge helper
function getAuthorBadge(authorType: AuthorType, userId: string): string {
  if (authorType === 'ai') {
    return 'Clay 🏗️';
  }
  // For human, use the user_id but capitalize first letter
  return userId.charAt(0).toUpperCase() + userId.slice(1);
}

// Jump to section helper
function jumpToSection(headingPath: string) {
  // Parse the last segment of the heading path (e.g., "Tech Stack" from "## Architecture > ### Tech Stack")
  const segments = headingPath.split(' > ');
  const lastSegment = segments[segments.length - 1];
  const headingText = lastSegment.replace(/^#+\s*/, '').replace(/[#§]+$/, '').trim();

  // Find the heading element whose text content matches
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const heading of headings) {
    if (getCleanHeadingText(heading) === headingText) {
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Add highlight animation
      heading.classList.add('thread-highlight');
      setTimeout(() => heading.classList.remove('thread-highlight'), 2000);
      return;
    }
  }
}

// Inline highlight helpers for bidirectional navigation
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Build a mapping from normalized-string index → original-string index.
// Returns an array of length normalizedStr.length + 1 (extra end sentinel).
function buildNormMap(original: string): number[] {
  const map: number[] = [];
  let i = 0;
  // Skip leading whitespace (trim)
  while (i < original.length && /\s/.test(original[i])) i++;
  // Find end of content (trim trailing whitespace)
  let end = original.length;
  while (end > i && /\s/.test(original[end - 1])) end--;

  while (i < end) {
    if (/\s/.test(original[i])) {
      map.push(i); // collapsed whitespace → single space
      while (i < end && /\s/.test(original[i])) i++;
    } else {
      map.push(i);
      i++;
    }
  }
  map.push(end); // end sentinel
  return map;
}

function highlightText(rootElement: Element, searchText: string, annotationId: string): boolean {
  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
  let node: Node | null;

  // First pass: exact match (fast path)
  while ((node = walker.nextNode())) {
    const idx = (node.textContent || '').indexOf(searchText);
    if (idx !== -1) {
      try {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + searchText.length);
        const mark = document.createElement('mark');
        mark.className = 'annotation-highlight';
        mark.dataset.annotationId = annotationId;
        range.surroundContents(mark);
        return true;
      } catch {
        return false;
      }
    }
  }

  // Second pass: normalized whitespace match
  const normalizedSearch = normalizeWs(searchText);
  if (normalizedSearch === searchText) return false; // already tried exact

  const walker2 = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
  while ((node = walker2.nextNode())) {
    const originalText = node.textContent || '';
    const normalizedText = normalizeWs(originalText);
    const normIdx = normalizedText.indexOf(normalizedSearch);
    if (normIdx !== -1) {
      const indexMap = buildNormMap(originalText);
      const origStart = indexMap[normIdx];
      const origEnd = normIdx + normalizedSearch.length < indexMap.length
        ? indexMap[normIdx + normalizedSearch.length]
        : originalText.length;
      try {
        const range = document.createRange();
        range.setStart(node, origStart);
        range.setEnd(node, origEnd);
        const mark = document.createElement('mark');
        mark.className = 'annotation-highlight';
        mark.dataset.annotationId = annotationId;
        range.surroundContents(mark);
        return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}

function clearHighlights() {
  document.querySelectorAll('mark.annotation-highlight').forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
}

function jumpToAnnotation(annotation: Annotation) {
  if (annotation.quoted_text) {
    const mark = document.querySelector(`mark.annotation-highlight[data-annotation-id="${annotation.id}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.add('annotation-highlight--flash');
      setTimeout(() => mark.classList.remove('annotation-highlight--flash'), 2000);
      return;
    }
  }
  jumpToSection(annotation.heading_path);
}


export default function AnnotationThread({ docPath }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());
  const [expandedResolved, setExpandedResolved] = useState<Set<string>>(new Set());
  const [authenticated, setAuthenticated] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Thread collapse/expand state (tracks which threads have replies expanded)
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  // Archived section collapsed by default
  const [showArchived, setShowArchived] = useState(false);

  // Ref for preserving scroll position
  const threadContentRef = useRef<HTMLDivElement>(null);

  // Reply state management
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Drafts state
  const [drafts, setDrafts] = useState<DraftComment[]>([]);
  const [showDrafts, setShowDrafts] = useState(true);
  const [submitState, setSubmitState] = useState<{ isSubmitting: boolean; error: string | null; success: boolean }>({
    isSubmitting: false,
    error: null,
    success: false
  });
  const submittingRef = useRef(false);

  // Helper to update annotation status via API
  const patchAnnotation = useCallback(async (id: string, updates: Partial<Pick<Annotation, 'status'>>) => {
    try {
      const response = await authFetch(`/api/annotations/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        console.warn(`Failed to update annotation ${id}:`, response.status);
        return false;
      }

      return true;
    } catch (err) {
      console.warn(`Error updating annotation ${id}:`, err);
      return false;
    }
  }, []);


  // Recovery: restore falsely orphaned annotations
  const recoverOrphanedAnnotations = useCallback(async (annotations: Annotation[]): Promise<Annotation[]> => {
    const contentElement = document.querySelector('article.content');
    if (!contentElement) return annotations;

    const fullTextContent = contentElement.textContent || '';
    const allHeadings = Array.from(contentElement.querySelectorAll('h1, h2, h3, h4, h5, h6'));

    const updatedAnnotations: Annotation[] = [];

    for (const annotation of annotations) {
      let updatedAnnotation = { ...annotation };

      // Only process orphaned annotations for recovery
      if (annotation.status === 'orphaned') {
        let textExists = false;

        if (annotation.quoted_text) {
          // Check if quoted text exists in document
          textExists = fullTextContent.includes(annotation.quoted_text);
        } else {
          // Check if heading text exists (for general section comments)
          const segments = annotation.heading_path.split(' > ');
          const lastSegment = segments[segments.length - 1];
          const headingText = lastSegment.replace(/^#+\s*/, '').replace(/[#§]+$/, '').trim().toLowerCase();

          textExists = allHeadings.some(heading => {
            const cleanText = getCleanHeadingText(heading).toLowerCase();
            return cleanText.includes(headingText) || headingText.includes(cleanText);
          });
        }

        if (textExists) {
          // Restore annotation to submitted status
          const success = await patchAnnotation(annotation.id, { status: 'submitted' });
          if (success) {
            updatedAnnotation.status = 'submitted';
          }
        }
      }

      updatedAnnotations.push(updatedAnnotation);
    }

    return updatedAnnotations;
  }, [patchAnnotation]);

  // Detect orphaned annotations with simple quoted-text logic
  const detectOrphansAndDrift = useCallback(async (annotations: Annotation[]): Promise<Annotation[]> => {
    const contentElement = document.querySelector('article.content');
    if (!contentElement) return annotations;

    const fullTextContent = contentElement.textContent || '';
    const allHeadings = Array.from(contentElement.querySelectorAll('h1, h2, h3, h4, h5, h6'));

    const updatedAnnotations: Annotation[] = [];

    for (const annotation of annotations) {
      let updatedAnnotation = { ...annotation };

      // Skip if already resolved or orphaned
      if (annotation.status === 'resolved' || annotation.status === 'orphaned') {
        updatedAnnotations.push(updatedAnnotation);
        continue;
      }

      let textExists = false;

      if (annotation.quoted_text) {
        // Simple check: does the quoted text exist in the document?
        textExists = fullTextContent.includes(annotation.quoted_text);
      } else {
        // General section comment: check if heading text exists
        const segments = annotation.heading_path.split(' > ');
        const lastSegment = segments[segments.length - 1];
        const headingText = lastSegment.replace(/^#+\s*/, '').replace(/[#§]+$/, '').trim().toLowerCase();

        textExists = allHeadings.some(heading => {
          const cleanText = getCleanHeadingText(heading).toLowerCase();
          return cleanText.includes(headingText) || headingText.includes(cleanText);
        });
      }

      // Only mark as orphaned if text is truly gone
      if (!textExists) {
        const success = await patchAnnotation(annotation.id, { status: 'orphaned' });
        if (success) {
          updatedAnnotation.status = 'orphaned';
        }
      }

      updatedAnnotations.push(updatedAnnotation);
    }

    return updatedAnnotations;
  }, [patchAnnotation]);

  // Load panel visibility from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const visible = stored !== null ? stored === 'true' : window.innerWidth >= 1024;
    setIsVisible(visible);
    document.getElementById('layout')?.classList.toggle('thread-hidden', !visible);
  }, []);

  // Save panel visibility to localStorage
  const toggleVisibility = useCallback(() => {
    const newVisibility = !isVisible;
    setIsVisible(newVisibility);
    localStorage.setItem(STORAGE_KEY, String(newVisibility));
    document.getElementById('layout')?.classList.toggle('thread-hidden', !newVisibility);
  }, [isVisible]);

  // Fetch annotations
  const fetchAnnotations = useCallback(async () => {
    if (!isAuthenticated()) {
      setLoading(false);
      setAnnotations([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await authFetch(`/api/annotations?doc_path=${encodeURIComponent(docPath)}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // First, recover any falsely orphaned annotations
      const recoveredAnnotations = await recoverOrphanedAnnotations(data);

      // Then run orphan detection with simple quoted-text logic
      const scrollTop = threadContentRef.current?.scrollTop ?? 0;
      const processedAnnotations = await detectOrphansAndDrift(recoveredAnnotations);
      setAnnotations(processedAnnotations);
      // Restore scroll position after React re-render
      requestAnimationFrame(() => {
        if (threadContentRef.current) {
          threadContentRef.current.scrollTop = scrollTop;
        }
      });
    } catch (err) {
      console.warn('Failed to fetch annotations:', err);
      setError('Unable to load comments');
      setAnnotations([]);
    } finally {
      setLoading(false);
    }
  }, [docPath, recoverOrphanedAnnotations, detectOrphansAndDrift]);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchAnnotations();
    } finally {
      setRefreshing(false);
    }
  }, [fetchAnnotations]);

  useEffect(() => {
    if (docPath) {
      fetchAnnotations();
    }
  }, [docPath, fetchAnnotations]);

  // Listen for review submission events to refetch annotations
  useEffect(() => {
    const handleReviewSubmitted = () => {
      fetchAnnotations();
    };

    window.addEventListener('foundry-review-submitted', handleReviewSubmitted);

    return () => {
      window.removeEventListener('foundry-review-submitted', handleReviewSubmitted);
    };
  }, [fetchAnnotations]);

  // Check auth status and listen for auth events
  useEffect(() => {
    const checkAuth = () => {
      setAuthenticated(isAuthenticated());
    };

    const handleAuthUnlocked = () => {
      setAuthenticated(true);
      fetchAnnotations();
    };

    // Initial check
    checkAuth();

    window.addEventListener('foundry-auth-unlocked', handleAuthUnlocked);

    return () => {
      window.removeEventListener('foundry-auth-unlocked', handleAuthUnlocked);
    };
  }, [fetchAnnotations]);

  // Load drafts and keep in sync with localStorage
  useEffect(() => {
    const loadDrafts = () => {
      setDrafts(getDrafts(docPath));
    };
    loadDrafts();
    window.addEventListener('foundry-draft-updated', loadDrafts);
    window.addEventListener('storage', loadDrafts);
    return () => {
      window.removeEventListener('foundry-draft-updated', loadDrafts);
      window.removeEventListener('storage', loadDrafts);
    };
  }, [docPath]);

  // Submit drafts as a review
  const handleSubmit = useCallback(async () => {
    if (drafts.length === 0 || submittingRef.current) return;
    submittingRef.current = true;

    const confirmMessage = `Submit ${drafts.length} comment${drafts.length > 1 ? 's' : ''} for review?`;
    if (!window.confirm(confirmMessage)) {
      submittingRef.current = false;
      return;
    }

    setSubmitState({ isSubmitting: true, error: null, success: false });

    try {
      // Step 1: Create the review
      const reviewResponse = await authFetch(`/api/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc_path: docPath })
      });

      if (!reviewResponse.ok) {
        throw new Error(`Failed to create review: HTTP ${reviewResponse.status}`);
      }

      const review = await reviewResponse.json();
      const reviewId = review.id;

      // Step 2: Submit each draft as an annotation
      const annotationPromises = drafts.map(async (draft) => {
        const annotationResponse = await authFetch(`/api/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doc_path: draft.doc_path,
            heading_path: draft.heading_path,
            content_hash: draft.content_hash,
            quoted_text: draft.quoted_text,
            content: draft.content,
            author_type: 'human',
            review_id: reviewId
          })
        });

        if (!annotationResponse.ok) {
          throw new Error(`Failed to create annotation: HTTP ${annotationResponse.status}`);
        }

        const annotation = await annotationResponse.json();

        const patchResponse = await authFetch(`/api/annotations/${annotation.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'submitted' })
        });

        if (!patchResponse.ok) {
          throw new Error(`Failed to update annotation status: HTTP ${patchResponse.status}`);
        }

        return annotation;
      });

      await Promise.all(annotationPromises);

      // Step 3: Update review status to submitted
      const reviewPatchResponse = await authFetch(`/api/reviews/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'submitted', submitted_at: new Date().toISOString() })
      });

      if (!reviewPatchResponse.ok) {
        throw new Error(`Failed to update review status: HTTP ${reviewPatchResponse.status}`);
      }

      // Step 4: Clear drafts
      clearDrafts(docPath);
      setDrafts([]);

      setSubmitState({ isSubmitting: false, error: null, success: true });
      window.dispatchEvent(new CustomEvent('foundry-review-submitted'));

      setTimeout(() => {
        setSubmitState(prev => ({ ...prev, success: false }));
      }, 3000);

    } catch (err) {
      setSubmitState({
        isSubmitting: false,
        error: err instanceof Error ? err.message : 'Failed to submit review',
        success: false
      });
    } finally {
      submittingRef.current = false;
    }
  }, [drafts, docPath]);

  // Add section margin indicators
  useEffect(() => {
    if (annotations.length === 0) return;

    // Clean up any existing indicators
    document.querySelectorAll('.section-indicator').forEach(el => el.remove());

    // Group annotations by heading_path
    const annotationsByHeading = new Map<string, Annotation[]>();
    annotations.forEach(annotation => {
      if (!annotationsByHeading.has(annotation.heading_path)) {
        annotationsByHeading.set(annotation.heading_path, []);
      }
      annotationsByHeading.get(annotation.heading_path)!.push(annotation);
    });

    // Add indicators for headings with annotations
    annotationsByHeading.forEach((headingAnnotations, headingPath) => {
      // Parse the last segment of the heading path
      const segments = headingPath.split(' > ');
      const lastSegment = segments[segments.length - 1];
      const headingText = lastSegment.replace(/^#+\s*/, '').replace(/[#§]+$/, '').trim();

      // Find the heading element
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const heading of headings) {
        if (getCleanHeadingText(heading) === headingText) {
          // Create indicator
          const indicator = document.createElement('div');
          indicator.className = 'section-indicator';
          indicator.textContent = String(headingAnnotations.length);
          indicator.title = `${headingAnnotations.length} comment${headingAnnotations.length > 1 ? 's' : ''}`;

          // Position relative to heading (use heading's own offsetParent)
          if (heading instanceof HTMLElement) {
            heading.style.position = 'relative';

            indicator.style.position = 'absolute';
            indicator.style.top = `${(heading.offsetHeight / 2) - 10}px`;
            indicator.style.left = '-35px';

            // Add click handler to scroll to comment in thread
            indicator.addEventListener('click', (e) => {
              e.preventDefault();
              // Find the first comment for this heading and scroll to it
              const firstComment = document.querySelector(`[data-annotation-heading="${CSS.escape(headingPath)}"]`);
              if (firstComment) {
                firstComment.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Briefly highlight the comment
                firstComment.classList.add('thread-comment-highlight');
                setTimeout(() => firstComment.classList.remove('thread-comment-highlight'), 2000);
              }
            });

            heading.appendChild(indicator);
          }
          break;
        }
      }
    });

    // Cleanup function
    return () => {
      document.querySelectorAll('.section-indicator').forEach(el => el.remove());
    };
  }, [annotations]);

  // Apply inline text highlights and doc→thread click navigation
  useEffect(() => {
    clearHighlights();

    const contentElement = document.querySelector('article.content');
    if (!contentElement || annotations.length === 0) return;

    // Highlight quoted text for each annotation
    for (const annotation of annotations) {
      if (!annotation.quoted_text || annotation.quoted_text.length < 10) continue;
      highlightText(contentElement, annotation.quoted_text, annotation.id);
    }

    // Click handler: mark → auto-expand thread group and scroll to comment
    const handleMarkClick = (e: Event) => {
      const mark = (e.target as Element).closest('mark.annotation-highlight');
      if (!mark) return;
      const annotationId = (mark as HTMLElement).dataset.annotationId;
      if (!annotationId) return;

      // Look up the annotation from state
      const annotation = annotations.find(a => a.id === annotationId);
      if (!annotation) return;

      // 1. Ensure thread panel is visible
      setIsVisible(true);
      localStorage.setItem(STORAGE_KEY, 'true');
      document.getElementById('layout')?.classList.remove('thread-hidden');

      // 2. Determine section (active vs archived) and expand review group
      const isArchived = annotation.status === 'resolved';
      if (isArchived) {
        setShowArchived(true);
      }
      if (annotation.review_id) {
        const prefix = isArchived ? 'archive:' : 'active:';
        setExpandedReviews(prev => new Set(prev).add(prefix + annotation.review_id));
      }

      // 3. If this is a reply, expand the parent thread
      if (annotation.parent_id) {
        let topParentId = annotation.parent_id;
        let parent = annotations.find(a => a.id === topParentId);
        while (parent?.parent_id) {
          topParentId = parent.parent_id;
          parent = annotations.find(a => a.id === topParentId);
        }
        setExpandedThreads(prev => new Set(prev).add(topParentId));
      }

      // 4. Wait for React to render expanded content, then scroll
      requestAnimationFrame(() => {
        const comment = document.querySelector(`.thread-comment[data-annotation-id="${annotationId}"]`);
        if (comment) {
          comment.scrollIntoView({ behavior: 'smooth', block: 'center' });
          comment.classList.add('thread-comment-highlight');
          setTimeout(() => comment.classList.remove('thread-comment-highlight'), 2000);
        }
      });
    };

    contentElement.addEventListener('click', handleMarkClick);

    return () => {
      contentElement.removeEventListener('click', handleMarkClick);
      clearHighlights();
    };
  }, [annotations]);

  // Group annotations — orphaned annotations stay with their review group or ungrouped
  const groupedAnnotations = (): {
    reviewGroups: ReviewGroup[];
    ungrouped: Annotation[];
  } => {
    const reviewGroups: Map<string, Annotation[]> = new Map();
    const ungrouped: Annotation[] = [];

    annotations.forEach(annotation => {
      if (annotation.review_id) {
        if (!reviewGroups.has(annotation.review_id)) {
          reviewGroups.set(annotation.review_id, []);
        }
        reviewGroups.get(annotation.review_id)!.push(annotation);
      } else {
        ungrouped.push(annotation);
      }
    });

    return {
      reviewGroups: Array.from(reviewGroups.entries()).map(([review_id, annotations]) => ({
        review_id,
        annotations: annotations.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      })),
      ungrouped: ungrouped.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    };
  };

  // Build threaded structure with flattened replies
  const buildThreads = (annotations: Annotation[]): (Annotation & { replies?: Annotation[] })[] => {
    const topLevel = annotations.filter(a => !a.parent_id);
    const children = annotations.filter(a => a.parent_id);

    // Build a map of parent -> direct children
    const childMap = new Map<string, Annotation[]>();
    children.forEach(child => {
      const list = childMap.get(child.parent_id!) || [];
      list.push(child);
      childMap.set(child.parent_id!, list);
    });

    // Collect ALL descendants of a top-level annotation (flattened, sorted by created_at)
    const getAllDescendants = (rootId: string): Annotation[] => {
      const result: Annotation[] = [];
      const queue = [rootId];
      while (queue.length > 0) {
        const parentId = queue.shift()!;
        const directChildren = childMap.get(parentId) || [];
        for (const child of directChildren) {
          result.push(child);
          queue.push(child.id);
        }
      }
      return result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    };

    return topLevel.map(annotation => ({
      ...annotation,
      replies: getAllDescendants(annotation.id).length > 0 ? getAllDescendants(annotation.id) : undefined
    }));
  };

  // Submit reply to API
  const submitReply = useCallback(async (parentAnnotation: Annotation, content: string) => {
    if (!content.trim()) return;

    setReplySubmitting(true);
    try {
      const response = await authFetch('/api/annotations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          doc_path: parentAnnotation.doc_path,
          heading_path: parentAnnotation.heading_path,
          content_hash: '',
          quoted_text: null,
          content: content.trim(),
          parent_id: parentAnnotation.id,
          review_id: parentAnnotation.review_id,
          author_type: 'human'
        })
      });

      if (!response.ok) {
        console.warn('Failed to submit reply:', response.status);
        return false;
      }

      // Clear reply state and refresh annotations
      setReplyingTo(null);
      setReplyContent('');
      fetchAnnotations();
      return true;
    } catch (err) {
      console.warn('Error submitting reply:', err);
      return false;
    } finally {
      setReplySubmitting(false);
    }
  }, [fetchAnnotations]);

  const renderAnnotation = (annotation: Annotation & { replies?: Annotation[] }, isReply = false) => {
    const isResolved = annotation.status === 'resolved';
    const isDraft = annotation.status === 'draft';
    const isOrphaned = annotation.status === 'orphaned';
    const expanded = expandedResolved.has(annotation.id);

    return (
      <div
        key={annotation.id}
        className={`thread-comment ${isDraft ? 'thread-comment--draft' : ''} ${isResolved ? 'thread-comment--resolved' : ''} ${isOrphaned ? 'thread-comment--stale' : ''} ${isReply ? 'thread-reply' : ''}`}
        data-annotation-id={annotation.id}
        data-annotation-heading={annotation.heading_path}
        onClick={() => jumpToAnnotation(annotation)}
        style={{ cursor: 'pointer' }}
      >
        {isResolved && !expanded ? (
          <div className="thread-comment-collapsed" onClick={(e) => { e.stopPropagation(); setExpandedResolved(prev => new Set(prev).add(annotation.id)); }}>
            <div className="thread-comment-meta">
              <span className="thread-comment-author">{getAuthorBadge(annotation.author_type, annotation.user_id)}</span>
              <span className="thread-comment-time">{relativeTime(annotation.created_at)}</span>
            </div>
            <span className="thread-comment-preview">{annotation.content.slice(0, 50)}...</span>
            {authenticated && (
              <button
                className="thread-reopen-btn"
                onClick={async (e) => {
                  e.stopPropagation();
                  const success = await patchAnnotation(annotation.id, { status: "submitted" });
                  if (success) fetchAnnotations();
                }}
                title="Reopen"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="thread-comment-header">
              <div className="thread-comment-meta">
                <span className="thread-comment-author">
                  {getAuthorBadge(annotation.author_type, annotation.user_id)}
                </span>
                <span className="thread-comment-time">{relativeTime(annotation.created_at)}</span>
              </div>
              <div className="thread-comment-actions">
                {authenticated && (
                  <button
                    className="thread-reply-btn"
                    onClick={(e) => { e.stopPropagation(); setReplyingTo(annotation.id); setReplyContent(''); }}
                    title="Reply"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                  </button>
                )}
                {authenticated && !isReply && !isResolved && (
                  <button
                    className="thread-resolve-btn"
                    onClick={async (e) => {
                      e.stopPropagation();
                      setResolvingId(annotation.id);
                      const success = await patchAnnotation(annotation.id, { status: "resolved" });
                      if (success) {
                        if (annotation.review_id) {
                          const reviewAnnotations = annotations.filter(a => a.review_id === annotation.review_id);
                          const allResolved = reviewAnnotations.every(a => a.id === annotation.id || a.status === "resolved");
                          if (allResolved) {
                            try {
                              await authFetch(`/api/reviews/${annotation.review_id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "complete", completed_at: new Date().toISOString() })
                              });
                            } catch (err) {
                              console.warn("Failed to auto-complete review:", err);
                            }
                          }
                        }
                        fetchAnnotations();
                      }
                      setResolvingId(null);
                    }}
                    disabled={resolvingId === annotation.id}
                    title="Resolve"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  </button>
                )}
                {isResolved && (
                  <button
                    className="thread-comment-collapse"
                    onClick={(e) => { e.stopPropagation(); setExpandedResolved(prev => { const next = new Set(prev); next.delete(annotation.id); return next; }); }}
                    title="Collapse"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {annotation.quoted_text && (
              <blockquote className="thread-comment-quote">
                {annotation.quoted_text}
              </blockquote>
            )}

            <div className="thread-comment-content">
              {annotation.content}
            </div>

            {/* Reply editor */}
            {replyingTo === annotation.id && (
              <div className="thread-reply-editor" onClick={(e) => e.stopPropagation()}>
                <textarea
                  className="thread-reply-editor__textarea"
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  placeholder="Write a reply..."
                  rows={3}
                  autoFocus
                />
                <div className="thread-reply-editor__actions">
                  <button
                    className="thread-reply-editor__cancel"
                    onClick={() => { setReplyingTo(null); setReplyContent(''); }}
                    disabled={replySubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    className="thread-reply-editor__submit"
                    onClick={() => submitReply(annotation, replyContent)}
                    disabled={!replyContent.trim() || replySubmitting}
                  >
                    {replySubmitting ? 'Replying...' : 'Reply'}
                  </button>
                </div>
              </div>
            )}

            {!isReply && annotation.replies && annotation.replies.length > 0 && (
              expandedThreads.has(annotation.id) ? (
                <>
                  <button
                    className="thread-replies-toggle"
                    onClick={(e) => { e.stopPropagation(); setExpandedThreads(prev => { const next = new Set(prev); next.delete(annotation.id); return next; }); }}
                  >
                    💬 {annotation.replies.length} {annotation.replies.length === 1 ? 'reply' : 'replies'} ▾
                  </button>
                  <div className="thread-replies">
                    {annotation.replies.map(reply => renderAnnotation(reply, true))}
                  </div>
                </>
              ) : (
                <button
                  className="thread-replies-toggle"
                  onClick={(e) => { e.stopPropagation(); setExpandedThreads(prev => new Set(prev).add(annotation.id)); }}
                >
                  💬 {annotation.replies.length} {annotation.replies.length === 1 ? 'reply' : 'replies'} ▸
                </button>
              )
            )}
          </>
        )}
      </div>
    );
  };

  const renderEmpty = () => (
    <div className="thread-empty">
      <p>No comments yet</p>
    </div>
  );

  const handleRequestAuth = () => {
    window.dispatchEvent(new CustomEvent('foundry-auth-required'));
  };

  const renderAuthPrompt = () => (
    <div className="thread-auth-prompt">
      <div className="thread-auth-prompt__content">
        <div className="thread-auth-prompt__icon">🔒</div>
        <div className="thread-auth-prompt__text">
          <p>Enter your access token to view annotations</p>
          <button
            className="thread-auth-prompt__button"
            onClick={handleRequestAuth}
          >
            Unlock
          </button>
        </div>
      </div>
    </div>
  );

  const { reviewGroups, ungrouped } = groupedAnnotations();

  // Build all threads and split into active/archived
  const allThreads = buildThreads([...ungrouped, ...reviewGroups.flatMap(g => g.annotations)]);
  const activeThreads = allThreads.filter(t => t.status !== 'resolved');
  const archivedThreads = allThreads.filter(t => t.status === 'resolved');

  // Group active threads by review_id for section headers
  const renderThreadsByReview = (threads: typeof allThreads, sectionPrefix: string = '') => {
    // Split into ungrouped (no review_id) and review-grouped
    const noReview = threads.filter(t => !t.review_id);
    const byReview = new Map<string, typeof threads>();
    threads.filter(t => t.review_id).forEach(t => {
      const list = byReview.get(t.review_id!) || [];
      list.push(t);
      byReview.set(t.review_id!, list);
    });

    return (
      <>
        {noReview.map(annotation => renderAnnotation(annotation))}
        {Array.from(byReview.entries()).map(([reviewId, reviewThreads]) => {
          const expandKey = `${sectionPrefix}${reviewId}`;
          const isExpanded = expandedReviews.has(expandKey);
          return (
            <div key={reviewId} className="thread-review-group">
              <button
                className="thread-review-header"
                onClick={() => setExpandedReviews(prev => {
                  const next = new Set(prev);
                  if (next.has(expandKey)) {
                    next.delete(expandKey);
                  } else {
                    next.add(expandKey);
                  }
                  return next;
                })}
              >
                <span className="thread-review-arrow">{isExpanded ? '▼' : '▶'}</span>
                <span>Review · {reviewThreads.length} thread{reviewThreads.length > 1 ? 's' : ''} · {relativeTime(reviewThreads[0].created_at)}</span>
              </button>

              {isExpanded && (
                <div className="thread-review-comments">
                  {reviewThreads.map(annotation => renderAnnotation(annotation))}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className={`thread-panel ${!isVisible ? 'thread-panel--hidden' : ''}`}>
      <div className="thread-header">
        <h3>Review</h3>
        {drafts.length > 0 && (
          <button
            className={`thread-submit-btn ${submitState.isSubmitting ? 'thread-submit-btn--loading' : ''}`}
            onClick={handleSubmit}
            disabled={submitState.isSubmitting}
            title={`Submit ${drafts.length} comment${drafts.length > 1 ? 's' : ''} for review`}
          >
            {submitState.isSubmitting ? '🔄' : `📤 Submit (${drafts.length})`}
          </button>
        )}
        <button
          className={`thread-refresh-btn ${refreshing ? 'thread-refresh-btn--spinning' : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh annotations"
          title="Refresh annotations"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
        <button
          className="thread-toggle"
          onClick={toggleVisibility}
          aria-label={isVisible ? "Hide thread panel" : "Show thread panel"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isVisible ? <polyline points="9 18 15 12 9 6"/> : <polyline points="15 18 9 12 15 6"/>}
          </svg>
        </button>
      </div>

      <div className="thread-content" ref={threadContentRef}>
        {!authenticated ? (
          renderAuthPrompt()
        ) : loading ? (
          <div className="thread-loading">Loading comments...</div>
        ) : error ? (
          <div className="thread-error">{error}</div>
        ) : (
          <>
            {submitState.success && (
              <div className="thread-submit-success">✅ Review submitted!</div>
            )}
            {submitState.error && (
              <div className="thread-submit-error">❌ {submitState.error}</div>
            )}

            {/* Drafts section — only shown when drafts exist */}
            {drafts.length > 0 && (
              <div className="thread-section">
                <button
                  className="thread-section-header thread-section-header--drafts"
                  onClick={() => setShowDrafts(!showDrafts)}
                >
                  <span className="thread-review-arrow">{showDrafts ? '▼' : '▶'}</span>
                  📝 Drafts ({drafts.length})
                </button>
                {showDrafts && (
                  <div className="thread-drafts-list">
                    {drafts.map(draft => (
                      <div key={draft.id} className="thread-draft-item">
                        <div className="thread-draft-heading">{draft.heading_path}</div>
                        <div className="thread-draft-preview">
                          {draft.content.slice(0, 80)}{draft.content.length > 80 ? '…' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Active section */}
            {activeThreads.length > 0 && (
              <div className="thread-section">
                <div className="thread-section-header">
                  Active ({activeThreads.length})
                </div>
                {renderThreadsByReview(activeThreads, 'active:')}
              </div>
            )}

            {/* Archived section */}
            {archivedThreads.length > 0 && (
              <div className="thread-section">
                <button
                  className="thread-section-header thread-section-header--archived"
                  onClick={() => setShowArchived(!showArchived)}
                >
                  <span className="thread-review-arrow">{showArchived ? '▼' : '▶'}</span>
                  📦 Archive ({archivedThreads.length})
                </button>
                {showArchived && renderThreadsByReview(archivedThreads, 'archive:')}
              </div>
            )}

            {/* Empty state */}
            {annotations.length === 0 && drafts.length === 0 && renderEmpty()}
          </>
        )}
      </div>
    </div>
  );
}
