import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export interface NavPage {
  title: string;
  path: string;
  access: 'public' | 'private';
}

type AccessMap = Record<string, string>;

function loadAccessMap(contentDir: string): AccessMap {
  const accessPath = path.join(contentDir, '.access.json');
  if (fs.existsSync(accessPath)) {
    try {
      return JSON.parse(fs.readFileSync(accessPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

function getAccessLevel(relativePath: string, accessMap: AccessMap): 'public' | 'private' {
  // Check longest prefix match first
  const prefixes = Object.keys(accessMap).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (relativePath.startsWith(prefix)) {
      return accessMap[prefix] as 'public' | 'private';
    }
  }
  return 'public';
}

function toTitleCase(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractTitle(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data } = matter(raw);
    if (data.nav_title) return data.nav_title;
    if (data.title) return data.title;
    // Fall back to first H1 header
    const h1Match = raw.match(/^#\s+(.+)$/m);
    if (h1Match) {
      return h1Match[1].replace(/[*_]/g, '').trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Recursively scan contentDir and build a flat list of {title, path, access} pages.
 * Matches the output format of the old nav-parser (parseNavPages from nav.yaml).
 */
function collectPages(
  dir: string,
  contentDir: string,
  accessMap: AccessMap,
  pages: NavPage[]
): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectPages(fullPath, contentDir, accessMap, pages);
    } else if (entry.name.endsWith('.md')) {
      const relativePath = path.relative(contentDir, fullPath);
      const title = extractTitle(fullPath) || toTitleCase(entry.name.replace(/\.md$/, ''));
      const access = getAccessLevel(relativePath, accessMap);

      pages.push({ title, path: relativePath, access });
    }
  }
}

let cachedPages: NavPage[] | null = null;

/**
 * Generate a flat list of pages from the filesystem.
 * Results are cached; call invalidateNavCache() on content changes.
 */
export function generateNavPages(contentDir: string): NavPage[] {
  if (cachedPages) return cachedPages;

  if (!fs.existsSync(contentDir)) {
    console.warn(`[nav-generator] Content dir not found: ${contentDir}`);
    return [];
  }

  const accessMap = loadAccessMap(contentDir);
  const pages: NavPage[] = [];
  collectPages(contentDir, contentDir, accessMap, pages);

  // Sort alphabetically by path for consistent ordering
  pages.sort((a, b) => a.path.localeCompare(b.path));

  cachedPages = pages;
  return pages;
}

/**
 * Clear the cached nav pages. Call after content mutations.
 */
export function invalidateNavCache(): void {
  cachedPages = null;
}
