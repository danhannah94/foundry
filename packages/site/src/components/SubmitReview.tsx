import { useState, useEffect } from 'react';
import { getDrafts, clearDrafts, type DraftComment } from '../utils/draft-storage.js';
import { authFetch } from '../utils/api.js';

interface Props {
  docPath: string;
}

interface SubmissionState {
  isSubmitting: boolean;
  error: string | null;
  success: boolean;
}

export default function SubmitReview({ docPath }: Props) {
  const [drafts, setDrafts] = useState<DraftComment[]>([]);
  const [submissionState, setSubmissionState] = useState<SubmissionState>({
    isSubmitting: false,
    error: null,
    success: false
  });

  // Load drafts on mount and when docPath changes
  useEffect(() => {
    const loadedDrafts = getDrafts(docPath);
    setDrafts(loadedDrafts);
  }, [docPath]);

  // Listen for localStorage changes to keep drafts in sync
  useEffect(() => {
    const handleStorageChange = () => {
      const loadedDrafts = getDrafts(docPath);
      setDrafts(loadedDrafts);
    };

    window.addEventListener('storage', handleStorageChange);
    // Also listen for custom events from CommentDraft operations
    window.addEventListener('foundry-draft-updated', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('foundry-draft-updated', handleStorageChange);
    };
  }, [docPath]);

  const handleSubmit = async () => {
    if (drafts.length === 0) return;

    const confirmMessage = `Submit ${drafts.length} comment${drafts.length > 1 ? 's' : ''} for review?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setSubmissionState({
      isSubmitting: true,
      error: null,
      success: false
    });

    try {
      // Step 1: Create the review
      const reviewResponse = await authFetch(`/api/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          doc_path: docPath
        })
      });

      if (!reviewResponse.ok) {
        throw new Error(`Failed to create review: HTTP ${reviewResponse.status}`);
      }

      const review = await reviewResponse.json();
      const reviewId = review.id;

      // Step 2: Submit each draft as an annotation
      const annotationPromises = drafts.map(async (draft) => {
        // Create annotation
        const annotationResponse = await authFetch(`/api/annotations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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

        // Update status to submitted
        const patchResponse = await authFetch(`/api/annotations/${annotation.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'submitted'
          })
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'submitted',
          submitted_at: new Date().toISOString()
        })
      });

      if (!reviewPatchResponse.ok) {
        throw new Error(`Failed to update review status: HTTP ${reviewPatchResponse.status}`);
      }

      // Step 4: Clear localStorage drafts
      clearDrafts(docPath);
      setDrafts([]);

      // Step 5: Show success and trigger refetch
      setSubmissionState({
        isSubmitting: false,
        error: null,
        success: true
      });

      // Dispatch custom event to trigger AnnotationThread refetch
      window.dispatchEvent(new CustomEvent('foundry-review-submitted'));

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSubmissionState(prev => ({ ...prev, success: false }));
      }, 3000);

    } catch (error) {
      console.error('Error submitting review:', error);
      setSubmissionState({
        isSubmitting: false,
        error: error instanceof Error ? error.message : 'Failed to submit review',
        success: false
      });
    }
  };

  // Don't render if no drafts
  if (drafts.length === 0) {
    return null;
  }

  return (
    <div className="submit-review">
      <button
        className={`submit-review__button ${submissionState.isSubmitting ? 'submit-review__button--loading' : ''}`}
        onClick={handleSubmit}
        disabled={submissionState.isSubmitting}
        title={`Submit ${drafts.length} comment${drafts.length > 1 ? 's' : ''} for review`}
      >
        {submissionState.isSubmitting ? (
          <>🔄 Submitting...</>
        ) : (
          <>📤 Submit Review ({drafts.length})</>
        )}
      </button>

      {submissionState.success && (
        <div className="submit-review__success">
          ✅ Review submitted!
        </div>
      )}

      {submissionState.error && (
        <div className="submit-review__error">
          ❌ {submissionState.error}
        </div>
      )}
    </div>
  );
}