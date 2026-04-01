import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch, isAuthenticated } from '../utils/api.js';
import { getCleanHeadingText } from '../utils/heading-text.js';

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


export default function AnnotationThread({ docPath }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());
  const [expandedResolved, setExpandedResolved] = useState<Set<string>>(new Set());
  const [showOrphaned, setShowOrphaned] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Ref for preserving scroll position
  const threadContentRef = useRef<HTMLDivElement>(null);

  // Reply state management
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

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
    if (stored !== null) {
      setIsVisible(stored === 'true');
    } else {
      // Default: hidden on mobile, visible on desktop
      setIsVisible(window.innerWidth >= 1024);
    }
  }, []);

  // Save panel visibility to localStorage
  const toggleVisibility = useCallback(() => {
    const newVisibility = !isVisible;
    setIsVisible(newVisibility);
    localStorage.setItem(STORAGE_KEY, String(newVisibility));
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

  // Group annotations
  const groupedAnnotations = (): {
    reviewGroups: ReviewGroup[];
    ungrouped: Annotation[];
    orphaned: Annotation[];
  } => {
    const reviewGroups: Map<string, Annotation[]> = new Map();
    const ungrouped: Annotation[] = [];
    const orphaned: Annotation[] = [];

    annotations.forEach(annotation => {
      if (annotation.status === 'orphaned') {
        orphaned.push(annotation);
      } else if (annotation.review_id) {
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
      ungrouped: ungrouped.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      orphaned: orphaned.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
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
        className={`thread-comment ${isDraft ? 'thread-comment--draft' : ''} ${isResolved ? 'thread-comment--resolved' : ''} ${isReply ? 'thread-reply' : ''}`}
        data-annotation-heading={annotation.heading_path}
      >
        {isResolved && !expanded ? (
          <div className="thread-comment-collapsed" onClick={() => setExpandedResolved(prev => new Set(prev).add(annotation.id))}>
            <span className="thread-comment-status">{getStatusIcon(annotation.status)}</span>
            <span className="thread-comment-author">{getAuthorBadge(annotation.author_type, annotation.user_id)}</span>
            <span className="thread-comment-preview">{annotation.content.slice(0, 50)}...</span>
            <span className="thread-comment-time">{relativeTime(annotation.created_at)}</span>
            {authenticated && (
              <button
                className="thread-reopen-btn"
                onClick={async (e) => {
                  e.stopPropagation(); // Don't expand the collapsed view
                  const success = await patchAnnotation(annotation.id, { status: "submitted" });
                  if (success) fetchAnnotations();
                }}
                title="Reopen"
              >
                ↩ Reopen
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="thread-comment-header">
              <span className={`thread-comment-status ${isDraft ? 'thread-comment-status--dimmed' : ''}`}>
                {getStatusIcon(annotation.status, !!annotation.replies?.length)}
              </span>
              <span className="thread-comment-author">
                {getAuthorBadge(annotation.author_type, annotation.user_id)}
              </span>
              <button
                className="thread-comment-jump"
                onClick={() => jumpToSection(annotation.heading_path)}
                title="Jump to section"
              >
                📍
              </button>
              <span className="thread-comment-time">{relativeTime(annotation.created_at)}</span>
              {authenticated && !isOrphaned && (
                <button
                  className="thread-reply-btn"
                  onClick={() => { setReplyingTo(annotation.id); setReplyContent(''); }}
                  title="Reply"
                >
                  ↩ Reply
                </button>
              )}
              {authenticated && !isReply && !isResolved && !isOrphaned && (
                <button
                  className="thread-resolve-btn"
                  onClick={async () => {
                    setResolvingId(annotation.id);
                    const success = await patchAnnotation(annotation.id, { status: "resolved" });
                    if (success) {
                      // Check if all annotations in this review are resolved
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
                  {resolvingId === annotation.id ? "..." : "✅ Resolve"}
                </button>
              )}
              {isResolved && (
                <button
                  className="thread-comment-collapse"
                  onClick={() => setExpandedResolved(prev => { const next = new Set(prev); next.delete(annotation.id); return next; })}
                  title="Collapse"
                >
                  ×
                </button>
              )}
            </div>

            {isOrphaned && (
              <div className="thread-comment-orphan-context">
                <strong>Original section:</strong> {annotation.heading_path}
              </div>
            )}

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
              <div className="thread-reply-editor">
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
              <div className="thread-replies">
                {annotation.replies.map(reply => renderAnnotation(reply, true))}
              </div>
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

  const { reviewGroups, ungrouped, orphaned } = groupedAnnotations();

  return (
    <div className={`thread-panel ${!isVisible ? 'thread-panel--hidden' : ''}`}>
      <div className="thread-header">
        <h3>💬 Review Thread</h3>
        <button
          className="thread-toggle"
          onClick={toggleVisibility}
          aria-label={isVisible ? "Hide thread panel" : "Show thread panel"}
        >
          {isVisible ? '→' : '←'}
        </button>
      </div>

      <div className="thread-content" ref={threadContentRef}>
        {!authenticated ? (
          renderAuthPrompt()
        ) : loading ? (
          <div className="thread-loading">Loading comments...</div>
        ) : error ? (
          <div className="thread-error">{error}</div>
        ) : annotations.length === 0 ? (
          renderEmpty()
        ) : (
          <>
            {/* Current/ungrouped comments */}
            {ungrouped.length > 0 && (
              <div className="thread-section">
                {buildThreads(ungrouped).map(annotation => renderAnnotation(annotation))}
              </div>
            )}

            {/* Review groups */}
            {reviewGroups.map(group => {
              const isExpanded = expandedReviews.has(group.review_id);
              const threadedAnnotations = buildThreads(group.annotations);

              return (
                <div key={group.review_id} className="thread-review-group">
                  <button
                    className="thread-review-header"
                    onClick={() => setExpandedReviews(prev => {
                      const next = new Set(prev);
                      if (next.has(group.review_id)) {
                        next.delete(group.review_id);
                      } else {
                        next.add(group.review_id);
                      }
                      return next;
                    })}
                  >
                    <span className="thread-review-arrow">{isExpanded ? '▼' : '▶'}</span>
                    Review #{group.review_id.slice(-6)} — {group.annotations.length} comment{group.annotations.length > 1 ? 's' : ''}
                  </button>

                  {isExpanded && (
                    <div className="thread-review-comments">
                      {threadedAnnotations.map(annotation => renderAnnotation(annotation))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Orphaned comments */}
            {orphaned.length > 0 && (
              <div className="thread-orphaned">
                <button
                  className="thread-orphaned-header"
                  onClick={() => setShowOrphaned(!showOrphaned)}
                >
                  <span className="thread-review-arrow">{showOrphaned ? '▼' : '▶'}</span>
                  ⚠️ Orphaned Comments ({orphaned.length})
                </button>

                {showOrphaned && (
                  <div className="thread-orphaned-comments">
                    {buildThreads(orphaned).map(annotation => renderAnnotation(annotation))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}