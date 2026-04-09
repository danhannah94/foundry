import { useState, useEffect, useRef } from 'react';
import {
  type DraftComment,
  getDrafts,
  saveDraft,
  updateDraft,
  deleteDraft
} from '../utils/draft-storage.js';
import { isAuthenticated } from '../utils/api.js';
import { getCleanHeadingText } from '../utils/heading-text.js';

interface Props {
  docPath: string;
}

interface FloatingButton {
  show: boolean;
  x: number;
  y: number;
  selectedText: string;
  headingPath: string;
  contentHash: string;
}

export default function CommentDraft({ docPath }: Props) {
  const [drafts, setDrafts] = useState<DraftComment[]>([]);
  const [floatingButton, setFloatingButton] = useState<FloatingButton>({ 
    show: false, 
    x: 0, 
    y: 0, 
    selectedText: '', 
    headingPath: '',
    contentHash: ''
  });
  const [editor, setEditor] = useState<{
    show: boolean;
    draft?: DraftComment;
    isEditing: boolean;
  }>({ show: false, isEditing: false });
  const [editorContent, setEditorContent] = useState('');

  // One-time recovery for #110: prior to the docPath prop fix, all drafts were
  // saved under localStorage key `foundry-drafts-undefined` regardless of which
  // doc they belonged to. The orphaned drafts also have `doc_path: undefined`
  // baked into the object, so we can't auto-route them back to their original
  // doc. Best we can do: back up the orphan blob to a timestamped key for
  // manual inspection, log full details to the console, and clear the active
  // orphan key so the bug doesn't keep accumulating dead drafts.
  useEffect(() => {
    try {
      const orphanKey = 'foundry-drafts-undefined';
      const orphanRaw = localStorage.getItem(orphanKey);
      if (!orphanRaw) return;

      const orphans: unknown = JSON.parse(orphanRaw);
      if (!Array.isArray(orphans) || orphans.length === 0) {
        localStorage.removeItem(orphanKey);
        return;
      }

      const backupKey = `foundry-drafts-orphan-backup-${Date.now()}`;
      localStorage.setItem(backupKey, orphanRaw);

      console.warn(
        `[Foundry] Recovered ${orphans.length} stranded draft comment(s) from bug #110.\n` +
        `Backup saved to localStorage["${backupKey}"]. Inspect via:\n` +
        `  JSON.parse(localStorage.getItem("${backupKey}"))\n` +
        `Drafts:`,
        orphans
      );

      localStorage.removeItem(orphanKey);
    } catch (e) {
      console.error('[Foundry] Error during draft recovery:', e);
    }
  }, []);

  // Load drafts from localStorage on mount and when docPath changes
  useEffect(() => {
    const loadedDrafts = getDrafts(docPath);
    setDrafts(loadedDrafts);
  }, [docPath]);

  // Listen for draft and review events to reload drafts
  useEffect(() => {
    const handleDraftUpdated = () => {
      const loadedDrafts = getDrafts(docPath);
      setDrafts(loadedDrafts);
    };

    const handleReviewSubmitted = () => {
      const loadedDrafts = getDrafts(docPath);
      setDrafts(loadedDrafts);
    };

    window.addEventListener('foundry-draft-updated', handleDraftUpdated);
    window.addEventListener('foundry-review-submitted', handleReviewSubmitted);

    return () => {
      window.removeEventListener('foundry-draft-updated', handleDraftUpdated);
      window.removeEventListener('foundry-review-submitted', handleReviewSubmitted);
    };
  }, [docPath]);

  // Listen for text selection
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setFloatingButton({ show: false, x: 0, y: 0, selectedText: '', headingPath: '', contentHash: '' });
        return;
      }

      // Check if selection is within .content article
      const range = selection.getRangeAt(0);
      const contentElement = document.querySelector('article.content');
      if (!contentElement || !contentElement.contains(range.commonAncestorContainer)) {
        setFloatingButton({ show: false, x: 0, y: 0, selectedText: '', headingPath: '', contentHash: '' });
        return;
      }

      // Exclude selections within draft list and comment editor elements
      const commonAncestor = range.commonAncestorContainer;
      const ancestorElement = commonAncestor.nodeType === Node.ELEMENT_NODE ?
        commonAncestor as Element :
        commonAncestor.parentElement;

      if (ancestorElement) {
        const draftList = ancestorElement.closest('.draft-list');
        const commentEditor = ancestorElement.closest('.comment-editor');

        if (draftList || commentEditor) {
          setFloatingButton({ show: false, x: 0, y: 0, selectedText: '', headingPath: '', contentHash: '' });
          return;
        }
      }

      const selectedText = selection.toString().trim();
      if (selectedText.length === 0) {
        setFloatingButton({ show: false, x: 0, y: 0, selectedText: '', headingPath: '', contentHash: '' });
        return;
      }

      // Only show comment button if user is authenticated
      if (!isAuthenticated()) {
        setFloatingButton({ show: false, x: 0, y: 0, selectedText: '', headingPath: '', contentHash: '' });
        return;
      }

      // Get position for floating button
      const rect = range.getBoundingClientRect();
      const x = rect.right + 8; // 8px offset from selection
      const y = rect.top - 4; // Viewport-relative for fixed positioning

      // Get heading path and content hash
      const headingPath = getHeadingPath(range.startContainer);
      const contentHash = getSectionContentHash(range.startContainer);

      setFloatingButton({
        show: true,
        x,
        y,
        selectedText,
        headingPath,
        contentHash
      });
    };

    const handleClickOutside = () => {
      // Hide floating button if selection is cleared
      if (window.getSelection()?.isCollapsed) {
        setFloatingButton({ show: false, x: 0, y: 0, selectedText: '', headingPath: '', contentHash: '' });
      }
    };

    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);
    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  const getHeadingPath = (node: Node): string => {
    let currentNode = node;
    const headings: { level: number; text: string; prefix: string }[] = [];

    // Walk up the DOM tree to find the nearest heading
    while (currentNode && currentNode !== document.body) {
      if (currentNode.nodeType === Node.ELEMENT_NODE) {
        const element = currentNode as Element;
        const tagName = element.tagName?.toLowerCase();
        
        if (tagName && tagName.match(/^h[1-6]$/)) {
          const level = parseInt(tagName.charAt(1));
          const text = getCleanHeadingText(element);
          const prefix = '#'.repeat(level);
          headings.push({ level, text, prefix });
        }
      }
      currentNode = currentNode.previousSibling || currentNode.parentNode;
    }

    // Walk backwards through all elements before the selection to build hierarchy
    const contentElement = document.querySelector('article.content');
    if (contentElement) {
      const allElements = Array.from(contentElement.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const nodeElement = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      
      if (nodeElement) {
        const hierarchy: { level: number; text: string; prefix: string }[] = [];
        
        for (const heading of allElements) {
          // Stop when we reach a heading that comes after our selection
          if (heading.compareDocumentPosition(nodeElement) & Node.DOCUMENT_POSITION_PRECEDING) {
            const level = parseInt(heading.tagName.charAt(1));
            const text = getCleanHeadingText(heading);
            const prefix = '#'.repeat(level);
            
            // Build hierarchy - keep only headings that form a proper hierarchy
            while (hierarchy.length > 0 && hierarchy[hierarchy.length - 1].level >= level) {
              hierarchy.pop();
            }
            
            hierarchy.push({ level, text, prefix });
          }
        }
        
        return hierarchy.map(h => `${h.prefix} ${h.text}`).join(' > ');
      }
    }

    return headings.length > 0 ? `${headings[0].prefix} ${headings[0].text}` : 'Document';
  };

  const getSectionContentHash = async (node: Node): Promise<string> => {
    const contentElement = document.querySelector('article.content');
    if (!contentElement) return '';

    // Find the heading element that contains this selection
    const allHeadings = Array.from(contentElement.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const nodeElement = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    
    if (!nodeElement) return '';

    let currentHeading: Element | null = null;
    
    // Find the closest preceding heading
    for (const heading of allHeadings) {
      if (heading.compareDocumentPosition(nodeElement) & Node.DOCUMENT_POSITION_PRECEDING) {
        currentHeading = heading;
      } else {
        break; // We've passed the selection
      }
    }

    if (!currentHeading) return '';

    // Get all content from this heading until the next heading of equal or higher level
    const currentLevel = parseInt(currentHeading.tagName.charAt(1));
    let sectionText = currentHeading.textContent || '';
    let nextElement = currentHeading.nextElementSibling;

    while (nextElement) {
      const tagName = nextElement.tagName?.toLowerCase();
      if (tagName && tagName.match(/^h[1-6]$/)) {
        const nextLevel = parseInt(tagName.charAt(1));
        if (nextLevel <= currentLevel) {
          break; // Found next section
        }
      }
      
      sectionText += nextElement.textContent || '';
      nextElement = nextElement.nextElementSibling;
    }

    // Generate SHA-256 hash
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(sectionText.trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return '';
    }
  };

  const handleCommentClick = async () => {
    if (!floatingButton.selectedText) return;

    const contentHash = await getSectionContentHash(
      document.getSelection()?.getRangeAt(0)?.startContainer || document.body
    );

    const newDraft: DraftComment = {
      id: crypto.randomUUID(),
      doc_path: docPath,
      heading_path: floatingButton.headingPath,
      content_hash: contentHash,
      quoted_text: floatingButton.selectedText,
      content: '',
      created_at: new Date().toISOString()
    };

    setEditor({ show: true, draft: newDraft, isEditing: false });
    setEditorContent('');
    setFloatingButton({ show: false, x: 0, y: 0, selectedText: '', headingPath: '', contentHash: '' });
    
    // Clear selection
    window.getSelection()?.removeAllRanges();
  };

  const handleSaveDraft = () => {
    if (!editor.draft) return;

    const updatedDraft = { ...editor.draft, content: editorContent };
    
    if (editor.isEditing) {
      updateDraft(docPath, editor.draft.id, editorContent);
      setDrafts(prevDrafts => 
        prevDrafts.map(d => d.id === editor.draft?.id ? updatedDraft : d)
      );
    } else {
      saveDraft(docPath, updatedDraft);
      setDrafts(prevDrafts => [...prevDrafts, updatedDraft]);
    }

    setEditor({ show: false, isEditing: false });
    setEditorContent('');
  };

  const handleCancelEdit = () => {
    setEditor({ show: false, isEditing: false });
    setEditorContent('');
  };

  const handleEditDraft = (draft: DraftComment) => {
    setEditor({ show: true, draft, isEditing: true });
    setEditorContent(draft.content);
  };

  const handleDeleteDraft = (draftId: string) => {
    if (confirm('Delete this draft comment?')) {
      deleteDraft(docPath, draftId);
      setDrafts(prevDrafts => prevDrafts.filter(d => d.id !== draftId));
    }
  };

  return (
    <>
      {/* Floating comment button */}
      {floatingButton.show && (
        <button
          className="comment-float-btn"
          style={{ left: floatingButton.x, top: floatingButton.y }}
          onClick={handleCommentClick}
          title="Add comment"
        >
          💬 Comment
        </button>
      )}

      {/* Inline editor */}
      {editor.show && editor.draft && (
        <div className="comment-editor">
          <div className="comment-editor__content">
            <h4>
              {editor.isEditing ? 'Edit Comment' : 'Add Comment'}
            </h4>
            
            <div className="comment-editor__context">
              <strong>Section:</strong> {editor.draft.heading_path}
            </div>

            <blockquote className="comment-editor__quote">
              "{editor.draft.quoted_text}"
            </blockquote>

            <textarea
              className="comment-editor__textarea"
              placeholder="Write your comment..."
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              rows={4}
              autoFocus
            />

            <div className="comment-editor__actions">
              <button
                className="comment-editor__save"
                onClick={handleSaveDraft}
                disabled={!editorContent.trim()}
              >
                Save Draft
              </button>
              <button
                className="comment-editor__cancel"
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draft list */}
      {drafts.length > 0 && (
        <div className="draft-list">
          <div className="draft-count">
            💬 {drafts.length} draft{drafts.length !== 1 ? 's' : ''}
          </div>
          
          {drafts.map(draft => (
            <div key={draft.id} className="draft-item">
              <div className="draft-item__header">
                <span className="draft-item__path">{draft.heading_path}</span>
                <span className="draft-item__date">
                  {new Date(draft.created_at).toLocaleDateString()}
                </span>
              </div>
              
              <blockquote className="draft-item__quote">
                "{draft.quoted_text.length > 100 
                  ? draft.quoted_text.substring(0, 100) + '...' 
                  : draft.quoted_text}"
              </blockquote>
              
              {draft.content && (
                <div className="draft-item__content">
                  {draft.content.length > 150 
                    ? draft.content.substring(0, 150) + '...'
                    : draft.content}
                </div>
              )}
              
              <div className="draft-item__actions">
                <button 
                  className="draft-item__edit"
                  onClick={() => handleEditDraft(draft)}
                >
                  Edit
                </button>
                <button 
                  className="draft-item__delete"
                  onClick={() => handleDeleteDraft(draft.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

