/**
 * Pages / doc-read service — listing pages, getting a page (with
 * sections) and fetching an individual section by heading path.
 *
 * Private-doc gating:
 *  - `listPages` takes `includePrivate: boolean` as a plain param. The
 *    route layer decides whether the caller is allowed to set it (auth +
 *    docs:read:private scope check); the service just filters.
 *  - `getPage` needs a `canReadPrivate` hint so it can enforce the
 *    private-doc gate for /docs/:path. The route layer passes
 *    `ctx.user?.scopes?.includes('docs:read:private') ?? false`; it
 *    intentionally does NOT use legacy-token bypass because the route
 *    today wraps requireAuth inline.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDocsPath } from '../config.js';
import { generateNavPages } from '../utils/nav-generator.js';
import { getAccessLevel } from '../access.js';
import { normalizeDocPath } from '../utils/normalize-doc-path.js';
import { parseSections, findSection } from '../utils/section-parser.js';
import type { AnvilInstance } from '../anvil-loader.js';
import type { AuthContext } from './context.js';
import { NotFoundError, ValidationError } from './errors.js';

// ─── listPages ────────────────────────────────────────────────────────────────

export interface ListPagesParams {
  includePrivate: boolean;
}

export interface NavPage {
  title: string;
  path: string;
  access: string;
}

export async function listPages(
  _ctx: AuthContext,
  params: ListPagesParams,
): Promise<NavPage[]> {
  const docsPath = getDocsPath();
  const allPages = generateNavPages(docsPath);

  return params.includePrivate
    ? allPages
    : allPages.filter(p => p.access === 'public');
}

// ─── getPage ──────────────────────────────────────────────────────────────────

export interface GetPageParams {
  path: string;
  /**
   * Whether the caller is allowed to read private docs. Derived by the
   * route layer from ctx.user.scopes / legacy token.
   */
  canReadPrivate: boolean;
}

export interface DocumentSection {
  heading: string;
  level: number;
  charCount: number;
  content: string;
}

export interface DocumentDetail {
  path: string;
  title: string;
  lastModified: string;
  sections: DocumentSection[];
}

/**
 * Anvil-backed page fetch. Caller passes in the resolved AnvilInstance.
 * Returns 401-worthy ValidationError when the target is private and the
 * caller lacks read:private (route maps to 401 to preserve existing contract).
 */
export async function getPage(
  _ctx: AuthContext,
  anvil: AnvilInstance,
  params: GetPageParams,
): Promise<DocumentDetail> {
  const rawPath = params.path;
  const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;

  const level = getAccessLevel(path);
  if (level === 'private' && !params.canReadPrivate) {
    throw new ValidationError('Authentication required for private content');
  }

  const page = await anvil.getPage(path);
  if (!page) {
    throw new NotFoundError('Document not found');
  }

  // Aggregate chunks into per-heading sections
  const sectionMap = new Map<string, DocumentSection>();
  const sortedChunks = [...page.chunks].sort((a, b) => a.ordinal - b.ordinal);

  for (const chunk of sortedChunks) {
    if (!chunk.heading_path) continue;
    const existing = sectionMap.get(chunk.heading_path);
    if (existing) {
      existing.content += '\n' + chunk.content;
      existing.charCount += chunk.char_count;
    } else {
      sectionMap.set(chunk.heading_path, {
        heading: chunk.heading_path,
        level: chunk.heading_level,
        charCount: chunk.char_count,
        content: chunk.content,
      });
    }
  }

  return {
    path: page.file_path,
    title: page.title,
    lastModified: page.last_modified,
    sections: Array.from(sectionMap.values()),
  };
}

// ─── getSection ───────────────────────────────────────────────────────────────

export interface GetSectionParams {
  path: string;
  headingPath: string;
}

export interface SectionDetail {
  path: string;
  heading: string;
  headingPath: string;
  level: number;
  content: string;
  charCount: number;
}

export async function getSection(
  _ctx: AuthContext,
  params: GetSectionParams,
): Promise<SectionDetail> {
  const docPath = normalizeDocPath(params.path);
  const headingPath = params.headingPath;

  const contentDir = getDocsPath();
  const filePath = join(contentDir, `${docPath}.md`);

  if (!existsSync(filePath)) {
    throw new NotFoundError(`Document not found: "${docPath}"`);
  }

  const lines = readFileSync(filePath, 'utf-8').split('\n');

  let section;
  try {
    section = findSection(lines, headingPath);
  } catch (err: any) {
    // findSection throws on ambiguous paths. Surface as ValidationError.
    if (err?.message?.includes('Ambiguous')) {
      throw new ValidationError(err.message);
    }
    throw err;
  }

  if (!section) {
    throw new NotFoundError(`Section not found: "${headingPath}"`, {
      available_headings: parseSections(lines).map(s => s.headingPath),
    });
  }

  const content = lines.slice(section.headingLine, section.subtreeEnd).join('\n');

  return {
    path: docPath,
    heading: section.headingText,
    headingPath: section.headingPath,
    level: section.level,
    content,
    charCount: content.length,
  };
}

// ─── listDocs (existing /docs endpoint) ───────────────────────────────────────

export interface DocumentListItem {
  path: string;
  title: string;
  lastModified: string;
  chunkCount: number;
}

export async function listDocs(
  _ctx: AuthContext,
  anvil: AnvilInstance,
): Promise<DocumentListItem[]> {
  const { pages } = await anvil.listPages();
  return pages.map(page => ({
    path: page.file_path,
    title: page.title,
    lastModified: page.last_modified,
    chunkCount: page.chunk_count,
  }));
}
