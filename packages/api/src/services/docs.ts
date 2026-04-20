/**
 * Docs service — write operations on the markdown corpus.
 *
 * Each function:
 *   - Accepts AuthContext + a typed params shape.
 *   - Performs the file / docs_meta / annotations mutation.
 *   - Invalidates caches + triggers reindex (via invalidateContent()).
 *
 * Throws NotFoundError / ValidationError / ConflictError from
 * services/errors.ts — the route layer maps to HTTP. The MCP tool layer
 * (S10b) will surface the error message directly.
 *
 * GitHub sync lives here too (`syncToGithub`) because it's document
 * corpus–adjacent: a cross-cutting write that touches the filesystem +
 * pushes the result.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { getDocsPath } from '../config.js';
import { getDb } from '../db.js';
import { getAccessLevel } from '../access.js';
import { normalizeDocPath } from '../utils/normalize-doc-path.js';
import { contentHash } from '../utils/hash.js';
import {
  parseSections,
  findSection,
  findDuplicateHeadings,
} from '../utils/section-parser.js';
import { syncToGithub as syncGithubLib } from '../sync.js';
import type { AuthContext } from './context.js';
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from './errors.js';

// Valid templates for document creation
const VALID_TEMPLATES = ['epic', 'subsystem', 'project', 'workflow', 'blank'] as const;
type TemplateName = (typeof VALID_TEMPLATES)[number];

// Map template names to file paths (relative to content dir)
const TEMPLATE_FILES: Record<Exclude<TemplateName, 'blank'>, string> = {
  epic: 'methodology/templates/epic-design-template.md',
  subsystem: 'methodology/templates/subsystem-design-template.md',
  project: 'methodology/templates/project-design-template.md',
  workflow: 'methodology/templates/workflow-template.md',
};

function titleFromPath(docPath: string): string {
  const slug = docPath.split('/').pop() || docPath;
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function readDocLines(filePath: string): string[] | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8').split('\n');
}

function writeDocAndUpdateMeta(filePath: string, lines: string[], docPath: string): void {
  const content = lines.join('\n');
  writeFileSync(filePath, content, 'utf-8');

  const hash = contentHash(content);
  const now = new Date().toISOString();
  const db = getDb();

  db.prepare(
    `UPDATE docs_meta SET content_hash = ?, modified_at = ? WHERE path = ?`,
  ).run(hash, now, docPath);
}

/**
 * Lazy-imported cache invalidation hook. The caller (index.ts)
 * re-exports `invalidateContent` from its module root; importing it
 * statically here would be fine in prod but creates a circular import
 * in tests that mock '../index.js'. We wrap it in a getter so tests can
 * mock the index module and still import this service file.
 */
async function invalidate(changedFiles?: string[]): Promise<void> {
  const mod = await import('../index.js');
  return mod.invalidateContent(changedFiles);
}

// ─── createDoc ────────────────────────────────────────────────────────────────

export interface CreateDocParams {
  path: string;
  template: string;
  title?: string;
  content?: string;
}

export interface CreateDocResult {
  path: string;
  title: string;
  template: string;
  created: true;
}

export async function createDoc(
  _ctx: AuthContext,
  params: CreateDocParams,
): Promise<CreateDocResult> {
  const { path: rawPath, template, title: userTitle, content: userContent } = params;

  if (!rawPath || typeof rawPath !== 'string') {
    throw new ValidationError('path is required and must be a string');
  }
  if (!template || typeof template !== 'string') {
    throw new ValidationError('template is required and must be a string');
  }
  if (!VALID_TEMPLATES.includes(template as TemplateName)) {
    throw new ValidationError(
      `Invalid template "${template}". Must be one of: ${VALID_TEMPLATES.join(', ')}`,
    );
  }

  const docPath = normalizeDocPath(rawPath);
  const contentDir = getDocsPath();
  const filePath = join(contentDir, `${docPath}.md`);

  if (existsSync(filePath)) {
    throw new ConflictError(`Document already exists at "${docPath}"`);
  }

  const title = userTitle || titleFromPath(docPath);

  let content: string;
  if (userContent && typeof userContent === 'string') {
    content = userContent;
  } else if (template === 'blank') {
    content = `# ${title}\n`;
  } else {
    const templateKey = template as Exclude<TemplateName, 'blank'>;
    const templatePath = join(contentDir, TEMPLATE_FILES[templateKey]);
    if (!existsSync(templatePath)) {
      throw new ValidationError(
        `Template file not found: ${TEMPLATE_FILES[templateKey]}`,
      );
    }
    content = readFileSync(templatePath, 'utf-8');
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');

  const hash = contentHash(content);
  const now = new Date().toISOString();
  const access = getAccessLevel(docPath);
  const db = getDb();

  db.prepare(
    `INSERT INTO docs_meta (path, title, access, content_hash, modified_at, modified_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'system', ?)`,
  ).run(docPath, title, access, hash, now, now);

  await invalidate();

  return { path: docPath, title, template, created: true };
}

// ─── updateSection ────────────────────────────────────────────────────────────

export interface UpdateSectionParams {
  path: string;
  headingPath: string;
  content: string;
}

export async function updateSection(
  _ctx: AuthContext,
  params: UpdateSectionParams,
): Promise<{ path: string; heading: string; updated: true }> {
  const docPath = normalizeDocPath(params.path);
  const headingPath = params.headingPath;
  const { content } = params;

  if (content === undefined || typeof content !== 'string') {
    throw new ValidationError('content is required and must be a string');
  }

  const contentDir = getDocsPath();
  const filePath = join(contentDir, `${docPath}.md`);
  const lines = readDocLines(filePath);

  if (!lines) {
    throw new NotFoundError(`Document not found: "${docPath}"`);
  }

  const dupes = findDuplicateHeadings(lines);
  if (dupes.has(headingPath)) {
    throw new ValidationError(
      `Ambiguous heading path "${headingPath}" appears ${dupes.get(headingPath)} times in the document. Cannot update.`,
    );
  }

  let section;
  try {
    section = findSection(lines, headingPath);
  } catch (err: any) {
    if (err?.message?.includes('Ambiguous heading path')) {
      throw new ValidationError(err.message);
    }
    throw err;
  }

  if (!section) {
    throw new NotFoundError(`Section not found: "${headingPath}"`, {
      available_headings: parseSections(lines).map(s => s.headingPath),
    });
  }

  const newBodyLines = content.length > 0 ? content.split('\n') : [];
  const updatedLines = [
    ...lines.slice(0, section.bodyStart),
    ...newBodyLines,
    ...lines.slice(section.subtreeEnd),
  ];

  writeDocAndUpdateMeta(filePath, updatedLines, docPath);
  await invalidate([`${docPath}.md`]);

  return { path: docPath, heading: headingPath, updated: true };
}

// ─── insertSection ────────────────────────────────────────────────────────────

export interface InsertSectionParams {
  path: string;
  after_heading: string;
  heading: string;
  level: number;
  content: string;
}

export async function insertSection(
  _ctx: AuthContext,
  params: InsertSectionParams,
): Promise<{ path: string; heading: string; inserted: true }> {
  const docPath = normalizeDocPath(params.path);
  const { after_heading, heading, level, content } = params;

  if (!after_heading || typeof after_heading !== 'string') {
    throw new ValidationError('after_heading is required and must be a string');
  }
  if (!heading || typeof heading !== 'string') {
    throw new ValidationError('heading is required and must be a string');
  }
  if (!level || typeof level !== 'number' || level < 1 || level > 6) {
    throw new ValidationError('level is required and must be a number between 1 and 6');
  }
  if (content === undefined || typeof content !== 'string') {
    throw new ValidationError('content is required and must be a string');
  }

  const contentDir = getDocsPath();
  const filePath = join(contentDir, `${docPath}.md`);
  const lines = readDocLines(filePath);

  if (!lines) {
    throw new NotFoundError(`Document not found: "${docPath}"`);
  }

  const dupes = findDuplicateHeadings(lines);
  if (dupes.has(after_heading)) {
    throw new ValidationError(
      `Ambiguous heading path "${after_heading}" appears ${dupes.get(after_heading)} times. Cannot determine insertion point.`,
    );
  }

  let afterSection;
  try {
    afterSection = findSection(lines, after_heading);
  } catch (err: any) {
    if (err?.message?.includes('Ambiguous heading path')) {
      throw new ValidationError(err.message);
    }
    throw err;
  }

  if (!afterSection) {
    throw new NotFoundError(`Section not found: "${after_heading}"`, {
      available_headings: parseSections(lines).map(s => s.headingPath),
    });
  }

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
  await invalidate([`${docPath}.md`]);

  return { path: docPath, heading, inserted: true };
}

// ─── moveSection ──────────────────────────────────────────────────────────────

export interface MoveSectionParams {
  path: string;
  heading: string;
  after_heading: string;
}

export async function moveSection(
  _ctx: AuthContext,
  params: MoveSectionParams,
): Promise<{ path: string; heading: string; after_heading: string; moved: true }> {
  const docPath = normalizeDocPath(params.path);
  const { heading, after_heading } = params;

  if (!heading || typeof heading !== 'string') {
    throw new ValidationError('heading is required and must be a string');
  }
  if (!after_heading || typeof after_heading !== 'string') {
    throw new ValidationError('after_heading is required and must be a string');
  }

  const contentDir = getDocsPath();
  const filePath = join(contentDir, `${docPath}.md`);
  const lines = readDocLines(filePath);

  if (!lines) {
    throw new NotFoundError(`Document not found: "${docPath}"`);
  }

  const dupes = findDuplicateHeadings(lines);
  if (dupes.has(heading)) {
    throw new ValidationError(
      `Ambiguous heading path "${heading}" appears ${dupes.get(heading)} times. Cannot determine which section to move.`,
    );
  }
  if (dupes.has(after_heading)) {
    throw new ValidationError(
      `Ambiguous heading path "${after_heading}" appears ${dupes.get(after_heading)} times. Cannot determine target position.`,
    );
  }

  const sourceSection = findSection(lines, heading);
  if (!sourceSection) {
    throw new NotFoundError(`Source section not found: "${heading}"`, {
      available_headings: parseSections(lines).map(s => s.headingPath),
    });
  }

  const targetSection = findSection(lines, after_heading);
  if (!targetSection) {
    throw new NotFoundError(`Target section not found: "${after_heading}"`, {
      available_headings: parseSections(lines).map(s => s.headingPath),
    });
  }

  if (sourceSection.headingLine === targetSection.headingLine) {
    throw new ValidationError('Cannot move a section after itself');
  }

  const sourceLines = lines.slice(sourceSection.headingLine, sourceSection.subtreeEnd);

  const withoutSource = [
    ...lines.slice(0, sourceSection.headingLine),
    ...lines.slice(sourceSection.subtreeEnd),
  ];

  const targetInModified = findSection(withoutSource, after_heading);
  if (!targetInModified) {
    throw new ValidationError(
      `Target section "${after_heading}" is a descendant of source section "${heading}". Cannot move a section after its own descendant.`,
    );
  }

  const insertAt = targetInModified.subtreeEnd;
  const updatedLines = [
    ...withoutSource.slice(0, insertAt),
    ...sourceLines,
    ...withoutSource.slice(insertAt),
  ];

  writeDocAndUpdateMeta(filePath, updatedLines, docPath);
  await invalidate([`${docPath}.md`]);

  return { path: docPath, heading, after_heading, moved: true };
}

// ─── deleteSection ────────────────────────────────────────────────────────────

export interface DeleteSectionParams {
  path: string;
  headingPath: string;
}

export async function deleteSection(
  _ctx: AuthContext,
  params: DeleteSectionParams,
): Promise<{ path: string; heading: string; deleted: true }> {
  const docPath = normalizeDocPath(params.path);
  const headingPath = params.headingPath;

  const contentDir = getDocsPath();
  const filePath = join(contentDir, `${docPath}.md`);
  const lines = readDocLines(filePath);

  if (!lines) {
    throw new NotFoundError(`Document not found: "${docPath}"`);
  }

  const dupes = findDuplicateHeadings(lines);
  if (dupes.has(headingPath)) {
    throw new ValidationError(
      `Ambiguous heading path "${headingPath}" appears ${dupes.get(headingPath)} times. Cannot determine which section to delete.`,
    );
  }

  let section;
  try {
    section = findSection(lines, headingPath);
  } catch (err: any) {
    if (err?.message?.includes('Ambiguous heading path')) {
      throw new ValidationError(err.message);
    }
    throw err;
  }

  if (!section) {
    throw new NotFoundError(`Section not found: "${headingPath}"`, {
      available_headings: parseSections(lines).map(s => s.headingPath),
    });
  }

  if (section.level === 1) {
    throw new ValidationError(
      'Cannot delete the H1 heading of a document. Use delete_doc to remove the entire document.',
    );
  }

  const updatedLines = [
    ...lines.slice(0, section.headingLine),
    ...lines.slice(section.subtreeEnd),
  ];

  writeDocAndUpdateMeta(filePath, updatedLines, docPath);
  await invalidate([`${docPath}.md`]);

  return { path: docPath, heading: headingPath, deleted: true };
}

// ─── deleteDoc ────────────────────────────────────────────────────────────────

export interface DeleteDocResult {
  path: string;
  deleted: true;
  annotations_deleted: number;
}

export async function deleteDoc(
  _ctx: AuthContext,
  params: { path: string },
): Promise<DeleteDocResult> {
  const docPath = normalizeDocPath(params.path);
  const contentDir = getDocsPath();
  const filePath = join(contentDir, `${docPath}.md`);

  const db = getDb();
  const metaRow = db.prepare('SELECT path FROM docs_meta WHERE path = ?').get(docPath);

  if (!existsSync(filePath) || !metaRow) {
    throw new NotFoundError(`Document not found: "${docPath}"`);
  }

  const deleteAnnotationsStmt = db.prepare('DELETE FROM annotations WHERE doc_path = ?');
  const annotationsResult = deleteAnnotationsStmt.run(docPath);
  const annotationsDeleted = annotationsResult.changes;

  db.prepare('DELETE FROM docs_meta WHERE path = ?').run(docPath);

  try {
    unlinkSync(filePath);
  } catch (err) {
    console.error('[docs.deleteDoc] Failed to unlink file:', err);
    // File may be gone already — DB rows removed, continue.
  }

  await invalidate([`${docPath}.md`]);

  return { path: docPath, deleted: true, annotations_deleted: annotationsDeleted };
}

// ─── syncToGithub ─────────────────────────────────────────────────────────────

export interface SyncToGithubParams {
  remote?: string;
  branch?: string;
}

export async function syncToGithub(
  _ctx: AuthContext,
  params: SyncToGithubParams,
): Promise<{ filesSync: number; commitHash: string; duration_ms: number }> {
  const remoteUrl = params.remote || process.env.SYNC_REMOTE_URL;
  if (!remoteUrl || typeof remoteUrl !== 'string') {
    throw new ValidationError(
      'remote is required — provide in body or set SYNC_REMOTE_URL env var',
    );
  }

  const contentDir = getDocsPath();
  return await syncGithubLib({
    contentDir,
    remoteUrl,
    branch: params.branch || 'main',
    deployKeyPath: process.env.DEPLOY_KEY_PATH || undefined,
  });
}
