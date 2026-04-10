/**
 * Express CRUD routes for Foundry documents.
 *
 * POST   /api/docs                              — Create new document
 * PUT    /api/docs/:path(*)/sections/:heading(*) — Update section body
 * POST   /api/docs/:path(*)/sections             — Insert new section
 * DELETE /api/docs/:path(*)/sections/:heading(*) — Delete section
 *
 * All endpoints require auth (requireAuth middleware).
 * All write endpoints invalidate Astro page cache + API nav cache + Anvil index.
 */

import { Router, Request, Response } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { requireAuth } from '../middleware/auth.js';
import { getDocsPath } from '../config.js';
import { getDb } from '../db.js';
import { invalidateContent } from '../index.js';
import { getAccessLevel } from '../access.js';
import { normalizeDocPath } from '../utils/normalize-doc-path.js';
import { contentHash } from '../utils/hash.js';
import { parseSections, findSection, findDuplicateHeadings } from '../utils/section-parser.js';

// Valid templates for document creation
const VALID_TEMPLATES = ['epic', 'subsystem', 'project', 'workflow', 'blank'] as const;
type TemplateName = typeof VALID_TEMPLATES[number];

// Map template names to file paths (relative to content dir)
const TEMPLATE_FILES: Record<Exclude<TemplateName, 'blank'>, string> = {
  epic: 'methodology/templates/epic-design-template.md',
  subsystem: 'methodology/templates/subsystem-design-template.md',
  project: 'methodology/templates/project-design-template.md',
  workflow: 'methodology/templates/workflow-template.md',
};

/**
 * Derive a human-readable title from a doc path.
 * "methodology/new-doc" -> "New Doc"
 */
function titleFromPath(docPath: string): string {
  const slug = docPath.split('/').pop() || docPath;
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Read a markdown file from disk, returning its lines.
 * Returns null if file doesn't exist.
 */
function readDocLines(filePath: string): string[] | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8').split('\n');
}

/**
 * Write lines back to disk and update docs_meta.
 */
function writeDocAndUpdateMeta(filePath: string, lines: string[], docPath: string): void {
  const content = lines.join('\n');
  writeFileSync(filePath, content, 'utf-8');

  const hash = contentHash(content);
  const now = new Date().toISOString();
  const db = getDb();

  db.prepare(`
    UPDATE docs_meta
    SET content_hash = ?, modified_at = ?
    WHERE path = ?
  `).run(hash, now, docPath);
}

export function createDocCrudRouter(): Router {
  const router = Router();

  // ──────────────────────────────────────────────
  // POST /api/docs — Create new document
  // ──────────────────────────────────────────────
  router.post('/docs', requireAuth, async (req: Request, res: Response) => {
    try {
      const { path: rawPath, template, title: userTitle } = req.body;

      // Validate required params
      if (!rawPath || typeof rawPath !== 'string') {
        return res.status(400).json({ error: 'path is required and must be a string' });
      }
      if (!template || typeof template !== 'string') {
        return res.status(400).json({ error: 'template is required and must be a string' });
      }
      if (!VALID_TEMPLATES.includes(template as TemplateName)) {
        return res.status(400).json({
          error: `Invalid template "${template}". Must be one of: ${VALID_TEMPLATES.join(', ')}`,
        });
      }

      const docPath = normalizeDocPath(rawPath);
      const contentDir = getDocsPath();
      const filePath = join(contentDir, `${docPath}.md`);

      // 409 if file already exists
      if (existsSync(filePath)) {
        return res.status(409).json({ error: `Document already exists at "${docPath}"` });
      }

      // Determine title
      const title = userTitle || titleFromPath(docPath);

      // Build content
      let content: string;
      if (template === 'blank') {
        content = `# ${title}\n`;
      } else {
        const templatePath = join(contentDir, TEMPLATE_FILES[template as Exclude<TemplateName, 'blank'>]);
        if (!existsSync(templatePath)) {
          return res.status(400).json({
            error: `Template file not found: ${TEMPLATE_FILES[template as Exclude<TemplateName, 'blank'>]}`,
          });
        }
        content = readFileSync(templatePath, 'utf-8');
      }

      // Create directories and write file
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');

      // Compute hash and insert into docs_meta
      const hash = contentHash(content);
      const now = new Date().toISOString();
      const access = getAccessLevel(docPath);
      const db = getDb();

      db.prepare(`
        INSERT INTO docs_meta (path, title, access, content_hash, modified_at, modified_by, created_at)
        VALUES (?, ?, ?, ?, ?, 'system', ?)
      `).run(docPath, title, access, hash, now, now);

      // Invalidate caches + trigger reindex
      await invalidateContent();

      res.status(201).json({ path: docPath, title, template, created: true });
    } catch (error: any) {
      console.error('[doc-crud] Create failed:', error);
      res.status(500).json({ error: 'Failed to create document', message: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // PUT /api/docs/:path/sections/:heading — Update section body
  //
  // On no-match, returns 404 with { error, available_headings }.
  // NEVER silently appends or mutates — write tools throw on missing address.
  // ──────────────────────────────────────────────
  router.put('/docs/:path(*)/sections/:heading(*)', requireAuth, async (req: Request, res: Response) => {
    try {
      const docPath = normalizeDocPath(req.params.path);
      const headingPath = req.params.heading;
      const { content } = req.body;

      if (content === undefined || typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required and must be a string' });
      }

      const contentDir = getDocsPath();
      const filePath = join(contentDir, `${docPath}.md`);
      const lines = readDocLines(filePath);

      if (!lines) {
        return res.status(404).json({ error: `Document not found: "${docPath}"` });
      }

      // Check for duplicate headings first
      const dupes = findDuplicateHeadings(lines);
      if (dupes.has(headingPath)) {
        return res.status(400).json({
          error: `Ambiguous heading path "${headingPath}" appears ${dupes.get(headingPath)} times in the document. Cannot update.`,
        });
      }

      const section = findSection(lines, headingPath);
      if (!section) {
        return res.status(404).json({
          error: `Section not found: "${headingPath}"`,
          available_headings: parseSections(lines).map(s => s.headingPath),
        });
      }

      // Replace body content (keep heading line, replace everything after it until next heading)
      const newBodyLines = content.length > 0 ? content.split('\n') : [];
      const updatedLines = [
        ...lines.slice(0, section.bodyStart),
        ...newBodyLines,
        ...lines.slice(section.bodyEnd),
      ];

      writeDocAndUpdateMeta(filePath, updatedLines, docPath);

      // TODO: Optimistic locking — compare content_hash before write (future)

      await invalidateContent([`${docPath}.md`]);

      res.json({ path: docPath, heading: headingPath, updated: true });
    } catch (error: any) {
      // findSection throws on ambiguous paths
      if (error.message?.includes('Ambiguous heading path')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('[doc-crud] Update section failed:', error);
      res.status(500).json({ error: 'Failed to update section', message: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/docs/:path/sections — Insert new section
  //
  // On no-match for after_heading, returns 404 with { error, available_headings }.
  // NEVER silently appends — write tools throw on missing address.
  // ──────────────────────────────────────────────
  router.post('/docs/:path(*)/sections', requireAuth, async (req: Request, res: Response) => {
    try {
      const docPath = normalizeDocPath(req.params.path);
      const { after_heading, heading, level, content } = req.body;

      // Validate params
      if (!after_heading || typeof after_heading !== 'string') {
        return res.status(400).json({ error: 'after_heading is required and must be a string' });
      }
      if (!heading || typeof heading !== 'string') {
        return res.status(400).json({ error: 'heading is required and must be a string' });
      }
      if (!level || typeof level !== 'number' || level < 1 || level > 6) {
        return res.status(400).json({ error: 'level is required and must be a number between 1 and 6' });
      }
      if (content === undefined || typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required and must be a string' });
      }

      const contentDir = getDocsPath();
      const filePath = join(contentDir, `${docPath}.md`);
      const lines = readDocLines(filePath);

      if (!lines) {
        return res.status(404).json({ error: `Document not found: "${docPath}"` });
      }

      // Check for duplicate headings
      const dupes = findDuplicateHeadings(lines);
      if (dupes.has(after_heading)) {
        return res.status(400).json({
          error: `Ambiguous heading path "${after_heading}" appears ${dupes.get(after_heading)} times. Cannot determine insertion point.`,
        });
      }

      const afterSection = findSection(lines, after_heading);
      if (!afterSection) {
        return res.status(404).json({
          error: `Section not found: "${after_heading}"`,
          available_headings: parseSections(lines).map(s => s.headingPath),
        });
      }

      // Insert at the end of the after_heading section
      const insertAt = afterSection.subtreeEnd;
      const prefix = '#'.repeat(level);
      const newHeadingLine = `${prefix} ${heading}`;
      const newBodyLines = content.length > 0 ? content.split('\n') : [];
      const insertLines = ['', newHeadingLine, ...newBodyLines];

      const updatedLines = [
        ...lines.slice(0, insertAt),
        ...insertLines,
        ...lines.slice(insertAt),
      ];

      writeDocAndUpdateMeta(filePath, updatedLines, docPath);
      await invalidateContent([`${docPath}.md`]);

      res.status(201).json({ path: docPath, heading, inserted: true });
    } catch (error: any) {
      if (error.message?.includes('Ambiguous heading path')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('[doc-crud] Insert section failed:', error);
      res.status(500).json({ error: 'Failed to insert section', message: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // DELETE /api/docs/:path/sections/:heading — Delete section
  //
  // Cascades: removes the heading line, the section's prose, and ALL
  // descendant sections (everything until the next heading at level <=
  // the target's level). Use update_section if you only want to clear
  // prose without removing children.
  //
  // On no-match, returns 404 with { error, available_headings }.
  // NEVER silently mutates — write tools throw on missing address.
  // ──────────────────────────────────────────────
  router.delete('/docs/:path(*)/sections/:heading(*)', requireAuth, async (req: Request, res: Response) => {
    try {
      const docPath = normalizeDocPath(req.params.path);
      const headingPath = req.params.heading;

      const contentDir = getDocsPath();
      const filePath = join(contentDir, `${docPath}.md`);
      const lines = readDocLines(filePath);

      if (!lines) {
        return res.status(404).json({ error: `Document not found: "${docPath}"` });
      }

      // Check for duplicate headings
      const dupes = findDuplicateHeadings(lines);
      if (dupes.has(headingPath)) {
        return res.status(400).json({
          error: `Ambiguous heading path "${headingPath}" appears ${dupes.get(headingPath)} times. Cannot determine which section to delete.`,
        });
      }

      const section = findSection(lines, headingPath);
      if (!section) {
        return res.status(404).json({
          error: `Section not found: "${headingPath}"`,
          available_headings: parseSections(lines).map(s => s.headingPath),
        });
      }

      // Remove heading line + prose + entire descendant subtree.
      // subtreeEnd walks past all child sections, so deleting "## Parent"
      // also removes "### Child A", "### Child B", etc.
      const updatedLines = [
        ...lines.slice(0, section.headingLine),
        ...lines.slice(section.subtreeEnd),
      ];

      writeDocAndUpdateMeta(filePath, updatedLines, docPath);
      await invalidateContent([`${docPath}.md`]);

      res.json({ path: docPath, heading: headingPath, deleted: true });
    } catch (error: any) {
      if (error.message?.includes('Ambiguous heading path')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('[doc-crud] Delete section failed:', error);
      res.status(500).json({ error: 'Failed to delete section', message: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // DELETE /api/docs/:path — Hard delete an entire document
  //
  // Removes the markdown file, docs_meta row, and all annotations for the doc.
  // Returns 404 if the file does not exist OR docs_meta has no row.
  // Not recoverable — callers should sync_to_github first if they want a backup.
  // ──────────────────────────────────────────────
  router.delete('/docs/:path(*)', requireAuth, async (req: Request, res: Response) => {
    try {
      const docPath = normalizeDocPath(req.params.path);
      const contentDir = getDocsPath();
      const filePath = join(contentDir, `${docPath}.md`);

      const db = getDb();
      const metaRow = db.prepare('SELECT path FROM docs_meta WHERE path = ?').get(docPath);

      if (!existsSync(filePath) || !metaRow) {
        return res.status(404).json({ error: `Document not found: "${docPath}"` });
      }

      // Delete annotations tied to this doc, then docs_meta, then the file itself.
      const deleteAnnotationsStmt = db.prepare('DELETE FROM annotations WHERE doc_path = ?');
      const annotationsResult = deleteAnnotationsStmt.run(docPath);
      const annotationsDeleted = annotationsResult.changes;

      db.prepare('DELETE FROM docs_meta WHERE path = ?').run(docPath);

      try {
        unlinkSync(filePath);
      } catch (err: any) {
        console.error('[doc-crud] Failed to unlink file during delete_doc:', err);
        // File may be gone already — we already removed DB rows, so continue.
      }

      await invalidateContent([`${docPath}.md`]);

      res.json({
        path: docPath,
        deleted: true,
        annotations_deleted: annotationsDeleted,
      });
    } catch (error: any) {
      console.error('[doc-crud] Delete doc failed:', error);
      res.status(500).json({ error: 'Failed to delete document', message: error.message });
    }
  });

  return router;
}
