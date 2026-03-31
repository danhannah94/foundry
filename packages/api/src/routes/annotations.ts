import { Router, Request, Response } from 'express';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '../db.js';
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
}

/**
 * Creates the annotations router
 */
export function createAnnotationsRouter(): Router {
  const router = Router();

  // GET /annotations - List annotations with filters
  router.get('/annotations', async (req: Request<{}, Annotation[], {}, AnnotationListQuery>, res: Response<Annotation[]>) => {
    try {
      const { doc_path, section, status } = req.query;

      if (!doc_path) {
        return res.status(400).json({
          error: 'doc_path query parameter is required',
        } as any);
      }

      const db = getDb();

      let query = 'SELECT * FROM annotations WHERE doc_path = ?';
      const params: any[] = [doc_path];

      if (section) {
        query += ' AND heading_path LIKE ?';
        params.push(`%${section}%`);
      }

      if (status) {
        query += ' AND status = ?';
        params.push(status);
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
        author_type = 'human'
      } = req.body;

      // Validate required fields
      if (!doc_path || !heading_path || !content_hash || !content) {
        return res.status(400).json({
          error: 'doc_path, heading_path, content_hash, and content are required',
        } as any);
      }

      const db = getDb();
      const id = createId();
      const now = new Date().toISOString();

      const annotation: Annotation = {
        id,
        doc_path,
        heading_path,
        content_hash,
        quoted_text: quoted_text || null,
        content,
        parent_id: parent_id || null,
        review_id: null,
        user_id: 'dan',
        author_type,
        status: 'draft',
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
  router.patch('/annotations/:id', async (req: Request<{ id: string }, Annotation, Partial<Pick<Annotation, 'status' | 'content'>>>, res: Response<Annotation>) => {
    try {
      const { id } = req.params;
      const { status, content } = req.body;

      if (!status && !content) {
        return res.status(400).json({
          error: 'status or content must be provided',
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

  return router;
}