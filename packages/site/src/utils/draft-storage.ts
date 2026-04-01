export interface DraftComment {
  id: string;
  doc_path: string;
  heading_path: string;
  content_hash: string;
  quoted_text: string;
  content: string;
  created_at: string;
}

/**
 * Get all drafts for a specific document path from localStorage
 */
export function getDrafts(docPath: string): DraftComment[] {
  try {
    const key = `foundry-drafts-${docPath}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Save a new draft to localStorage
 */
export function saveDraft(docPath: string, draft: DraftComment): void {
  try {
    const key = `foundry-drafts-${docPath}`;
    const existing = getDrafts(docPath);
    const updated = [...existing, draft];
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('foundry-draft-updated'));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Update the content of an existing draft
 */
export function updateDraft(docPath: string, draftId: string, content: string): void {
  try {
    const key = `foundry-drafts-${docPath}`;
    const existing = getDrafts(docPath);
    const updated = existing.map(draft =>
      draft.id === draftId ? { ...draft, content } : draft
    );
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('foundry-draft-updated'));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Delete a specific draft
 */
export function deleteDraft(docPath: string, draftId: string): void {
  try {
    const key = `foundry-drafts-${docPath}`;
    const existing = getDrafts(docPath);
    const updated = existing.filter(draft => draft.id !== draftId);
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('foundry-draft-updated'));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

/**
 * Clear all drafts for a document path
 */
export function clearDrafts(docPath: string): void {
  try {
    const key = `foundry-drafts-${docPath}`;
    localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent('foundry-draft-updated'));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}