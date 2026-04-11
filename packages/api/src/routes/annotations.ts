import { Router, Request, Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '../db.js';
import { getDocsPath } from '../config.js';
import { normalizeDocPath } from '../utils/normalize-doc-path.js';
import {
  Annotation,
  CreateAnnotationBody,
  AnnotationStatus,
  AuthorType
} from '../types/annotations.js';

interface AnnotationListQuery {
  doc_path: string;
  section?: string;
  status?: AnnotationStatus;
  review_id?: string;
}

/**
 * Creates the annotations router
 */
export function createAnnotationsRouter(): Router {
  const router = Router();

  // GET /annotations - List annotations with filters
  router.get('/annotations', async (req: Request<{}, Annotation[], {}, AnnotationListQuery>, res: Response<Annotation[]>) => {
    try {
      const { doc_path, section, status, review_id } = req.query;

      if (!doc_path) {
        return res.status(400).json({
          error: 'doc_path query parameter is required',
        } as any);
      }

      const db = getDb();

      const normalized = normalizeDocPath(doc_path);
      let query = `SELECT * FROM annotations WHERE doc_path = ?`;
      const params: any[] = [normalized];

      if (section) {
        query += ' AND heading_path LIKE ?';
        params.push(`%${section}%`);
      }

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      if (review_id) {
        query += ' AND review_id = ?';
        params.push(review_id);
      }

      query += ' ORDER BY created_at DESC';

      const stmt = db.prepare(query);
      const rows = stmt.all(...params) as Annotation[];

      res.json(rows);
    } catch (error) {
      console.error('Error listing annotations:', error);
      res.status(500).json({
        error: 'Failed to list annotations',
      } as any);
    }
  });

  // GET /annotations/:id - Get single annotation with reply thread
  router.get('/annotations/:id', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDb();

      const annotation = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as Annotation | undefined;

      if (!annotation) {
        return res.status(404).json({ error: 'Annotation not found' });
      }

      const replies = db.prepare(
        'SELECT * FROM annotations WHERE parent_id = ? ORDER BY created_at ASC'
      ).all(id) as Annotation[];

      res.json({ annotation, replies });
    } catch (error) {
      console.error('Error getting annotation:', error);
      res.status(500).json({ error: 'Failed to get annotation' });
    }
  });

  // POST /annotations - Create new annotation
  router.post('/annotations', async (req: Request<{}, Annotation, CreateAnnotationBody>, res: Response<Annotation>) => {
    try {
      const {
        doc_path,
        heading_path,
        content_hash,
        quoted_text,
        content,
        parent_id,
        review_id,
        author_type = 'human',
        user_id,
        status: bodyStatus,
      } = req.body;

      // Validate required fields (content_hash is optional — used for drift detection)
      if (!doc_path || !heading_path || !content) {
        return res.status(400).json({
          error: 'doc_path, heading_path, and content are required',
        } as any);
      }

      // Validate status if explicitly provided
      const VALID_STATUSES: AnnotationStatus[] = ['draft', 'submitted', 'replied', 'resolved', 'orphaned'];
      if (bodyStatus !== undefined && !VALID_STATUSES.includes(bodyStatus)) {
        return res.status(400).json({
          error: `Invalid status "${bodyStatus}". Must be one of: ${VALID_STATUSES.join(', ')}`,
        } as any);
      }

      // Validate that the referenced document exists
      const normalizedPath = normalizeDocPath(doc_path);
      const contentDir = getDocsPath();
      const filePath = join(contentDir, `${normalizedPath}.md`);
      if (!existsSync(filePath)) {
        return res.status(404).json({
          error: `Document not found: "${normalizedPath}". Cannot create annotation on a non-existent document.`,
        } as any);
      }

      const db = getDb();
      const id = createId();
      const now = new Date().toISOString();

      // BUG-6: If replying to a parent, inherit its review_id when not explicitly provided
      let effectiveReviewId = review_id;
      if (parent_id && !review_id) {
        const parent = db.prepare('SELECT review_id FROM annotations WHERE id = ?').get(parent_id) as { review_id: string | null } | undefined;
        if (parent?.review_id) {
          effectiveReviewId = parent.review_id;
        }
      }

      // Check for duplicate annotation (same content + quoted_text + review_id within 30 seconds)
      if (review_id) {
        const recentDuplicate = db.prepare(`
          SELECT id FROM annotations
          WHERE review_id = ? AND content = ? AND quoted_text IS ?
          AND created_at > datetime('now', '-30 seconds')
        `).get(review_id, content, quoted_text || null);

        if (recentDuplicate) {
          // Return the existing annotation instead of creating a duplicate
          const existing = db.prepare('SELECT * FROM annotations WHERE id = ?').get((recentDuplicate as any).id);
          return res.status(200).json(existing as Annotation);
        }
      }

      const normalizedDocPath = normalizeDocPath(doc_path);

      // Determine status: explicit body value wins; otherwise default by author_type
      const effectiveStatus: AnnotationStatus =
        bodyStatus !== undefined
          ? bodyStatus
          : author_type === 'ai'
          ? 'submitted'
          : 'draft';

      const annotation: Annotation = {
        id,
        doc_path: normalizedDocPath,
        heading_path,
        content_hash: content_hash || '',
        quoted_text: quoted_text || null,
        content,
        parent_id: parent_id || null,
        review_id: effectiveReviewId || null,
        user_id: user_id || process.env.FOUNDRY_DEFAULT_USER || 'anonymous',
        author_type,
        status: effectiveStatus,
        created_at: now,
        updated_at: now,
      };

      const stmt = db.prepare(`
        INSERT INTO annotations (
          id, doc_path, heading_path, content_hash, quoted_text, content,
          parent_id, review_id, user_id, author_type, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        annotation.id,
        annotation.doc_path,
        annotation.heading_path,
        annotation.content_hash,
        annotation.quoted_text,
        annotation.content,
        annotation.parent_id,
        annotation.review_id,
        annotation.user_id,
        annotation.author_type,
        annotation.status,
        annotation.created_at,
        annotation.updated_at
      );

      res.status(201).json(annotation);
    } catch (error) {
      console.error('Error creating annotation:', error);
      res.status(500).json({
        error: 'Failed to create annotation',
      } as any);
    }
  });

  // PATCH /annotations/:id - Update annotation
  router.patch('/annotations/:id', async (req: Request<{ id: string }, Annotation, Partial<Pick<Annotation, 'status' | 'content' | 'review_id'>>>, res: Response<Annotation>) => {
    try {
      const { id } = req.params;
      const { status, content, review_id } = req.body;

      if (!status && !content && review_id === undefined) {
        return res.status(400).json({
          error: 'status, content, or review_id must be provided',
        } as any);
      }

      const db = getDb();

      // First check if annotation exists
      const existingStmt = db.prepare('SELECT * FROM annotations WHERE id = ?');
      const existing = existingStmt.get(id) as Annotation | undefined;

      if (!existing) {
        return res.status(404).json({
          error: 'Annotation not found',
        } as any);
      }

      const now = new Date().toISOString();
      const updates: string[] = [];
      const params: any[] = [];

      if (status !== undefined) {
        updates.push('status = ?');
        params.push(status);
      }

      if (content !== undefined) {
        updates.push('content = ?');
        params.push(content);
      }

      if (review_id !== undefined) {
        updates.push('review_id = ?');
        params.push(review_id);
      }

      updates.push('updated_at = ?');
      params.push(now);
      params.push(id);

      const updateStmt = db.prepare(`
        UPDATE annotations
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      updateStmt.run(...params);

      // Fetch updated annotation
      const updatedAnnotation = existingStmt.get(id) as Annotation;
      res.json(updatedAnnotation);
    } catch (error) {
      console.error('Error updating annotation:', error);
      res.status(500).json({
        error: 'Failed to update annotation',
      } as any);
    }
  });

  // DELETE /annotations/:id - Delete annotation (cascade children + orphan review cleanup)
  router.delete('/annotations/:id', async (req: Request<{ id: string }>, res: Response) => {
    try {
      const { id } = req.params;
      const db = getDb();

      // Check if annotation exists
      const existing = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as Annotation | undefined;

      if (!existing) {
        return res.status(404).json({
          error: 'Annotation not found',
        } as any);
      }

      // Cascade delete child replies first (foreign key constraint)
      db.prepare('DELETE FROM annotations WHERE parent_id = ?').run(id);

      // Delete the annotation itself
      db.prepare('DELETE FROM annotations WHERE id = ?').run(id);

      // Orphan review cleanup: if annotation had a review_id, check if any annotations remain
      if (existing.review_id) {
        const remaining = db.prepare(
          'SELECT COUNT(*) as count FROM annotations WHERE review_id = ?'
        ).get(existing.review_id) as { count: number };

        if (remaining.count === 0) {
          db.prepare('DELETE FROM reviews WHERE id = ?').run(existing.review_id);
        }
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting annotation:', error);
      res.status(500).json({
        error: 'Failed to delete annotation',
      } as any);
    }
  });

  return router;
}