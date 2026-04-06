import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';

export interface NavItem {
  title: string;
  path?: string;
  href?: string;
  children?: NavItem[];
  access?: string;
}

interface RawNavItem {
  title: string;
  path?: string;
  children?: RawNavItem[];
  access?: string;
}

function pathToHref(filePath: string): string {
  if (filePath === 'index.md') return '/';
  // Strip leading docs/ prefix — build.sh already strips this when copying content
  const normalizedPath = filePath.replace(/^docs\//, '');
  return '/docs/' + normalizedPath.replace(/\.md$/, '').replace(/\/index$/, '') + '/';
}

function processItems(items: RawNavItem[]): NavItem[] {
  return items.map((item) => {
    const result: NavItem = { title: item.title };
    if (item.path) {
      result.path = item.path;
      result.href = pathToHref(item.path);
    }
    if (item.access) {
      result.access = item.access;
    }
    if (item.children) {
      result.children = processItems(item.children);
    }
    return result;
  });
}

// --- Filesystem-based nav generation ---

type AccessMap = Record<string, string>;

function resolveContentDir(): string {
  // CONTENT_DIR env var takes priority (canonical path in Docker)
  if (process.env.CONTENT_DIR) {
    const envDir = path.resolve(process.env.CONTENT_DIR);
    if (fs.existsSync(envDir)) return envDir;
  }

  // Fallback: try relative paths for local dev
  const fromCwd = path.resolve(process.cwd(), 'content');
  if (fs.existsSync(fromCwd)) return fromCwd;

  const fromRelative = path.resolve(process.cwd(), '../../content');
  if (fs.existsSync(fromRelative)) return fromRelative;

  const fromSitePackage = path.resolve(__dirname, '../../content');
  if (fs.existsSync(fromSitePackage)) return fromSitePackage;

  throw new Error('Could not locate content/ directory. Set CONTENT_DIR env var or ensure content/ exists.');
}

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

function getAccessLevel(relativePath: string, accessMap: AccessMap): string {
  // Check longest prefix match first
  const prefixes = Object.keys(accessMap).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (relativePath.startsWith(prefix)) {
      return accessMap[prefix];
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
    // Try gray-matter frontmatter first
    const { data } = matter(raw);
    if (data.nav_title) return data.nav_title;
    if (data.title) return data.title;
    // Fall back to first H1 header
    const h1Match = raw.match(/^#\s+(.+)$/m);
    if (h1Match) {
      // Clean up the title — remove markdown emphasis and trailing markers
      return h1Match[1].replace(/[*_]/g, '').trim();
    }
    return null;
  } catch {
    return null;
  }
}

function extractOrder(filePath: string): number | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data } = matter(raw);
    if (typeof data.order === 'number') return data.order;
    return null;
  } catch {
    return null;
  }
}

interface FileEntry {
  name: string;
  relativePath: string;
  title: string;
  order: number | null;
  isDirectory: boolean;
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return entries.sort((a, b) => {
    // Items with order come first, sorted ascending
    if (a.order !== null && b.order !== null) return a.order - b.order;
    if (a.order !== null) return -1;
    if (b.order !== null) return 1;
    // Then alphabetical by title with natural numeric sorting
    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function buildNavTree(
  dir: string,
  contentDir: string,
  accessMap: AccessMap
): NavItem[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items: FileEntry[] = [];

  // Check for index.md in this directory
  const indexPath = path.join(dir, 'index.md');
  const hasIndex = fs.existsSync(indexPath);

  // Collect files (excluding index.md — it's used for the parent section)
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'index.md') continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Get title from index.md in the subdirectory, or title-case the dir name
      const subIndexPath = path.join(fullPath, 'index.md');
      let title: string;
      if (fs.existsSync(subIndexPath)) {
        title = extractTitle(subIndexPath) || toTitleCase(entry.name);
      } else {
        title = toTitleCase(entry.name);
      }

      items.push({
        name: entry.name,
        relativePath: path.relative(contentDir, fullPath),
        title,
        order: null,
        isDirectory: true,
      });
    } else if (entry.name.endsWith('.md')) {
      const title = extractTitle(fullPath) || toTitleCase(entry.name.replace(/\.md$/, ''));
      const order = extractOrder(fullPath);
      const relativePath = path.relative(contentDir, fullPath);

      items.push({
        name: entry.name,
        relativePath,
        title,
        order,
        isDirectory: false,
      });
    }
  }

  // Sort entries
  const sorted = sortEntries(items);

  // Build NavItem array
  const navItems: NavItem[] = [];

  for (const item of sorted) {
    if (item.isDirectory) {
      const fullPath = path.join(contentDir, item.relativePath);
      const children = buildNavTree(fullPath, contentDir, accessMap);

      // Skip empty directories
      if (children.length === 0) continue;

      const navItem: NavItem = { title: item.title };

      // If the directory has an index.md, set its href
      const subIndexPath = path.join(fullPath, 'index.md');
      if (fs.existsSync(subIndexPath)) {
        const indexRelative = path.relative(contentDir, subIndexPath);
        navItem.href = pathToHref(indexRelative);
        navItem.path = indexRelative;
      }

      const access = getAccessLevel(item.relativePath + '/', accessMap);
      if (access !== 'public') {
        navItem.access = access;
      }

      navItem.children = children;
      navItems.push(navItem);
    } else {
      const navItem: NavItem = {
        title: item.title,
        path: item.relativePath,
        href: pathToHref(item.relativePath),
      };

      const access = getAccessLevel(item.relativePath, accessMap);
      if (access !== 'public') {
        navItem.access = access;
      }

      navItems.push(navItem);
    }
  }

  return navItems;
}

function generateNavFromFilesystem(): NavItem[] {
  const contentDir = resolveContentDir();
  const accessMap = loadAccessMap(contentDir);
  return buildNavTree(contentDir, contentDir, accessMap);
}

// --- Main exports ---

let cachedNav: NavItem[] | null = null;

export function invalidateNav(): void {
  cachedNav = null;
}

export function getNavItems(): NavItem[] {
  if (cachedNav) return cachedNav;

  // Escape hatch: if nav.yaml exists, use the old yaml-based approach
  const navYamlPath = path.resolve(process.cwd(), '../../nav.yaml');
  if (fs.existsSync(navYamlPath)) {
    const raw = fs.readFileSync(navYamlPath, 'utf-8');
    const parsed = yaml.load(raw) as RawNavItem[];
    cachedNav = processItems(parsed);
    return cachedNav;
  }

  // Generate nav from filesystem
  cachedNav = generateNavFromFilesystem();
  return cachedNav;
}

function findBreadcrumbs(items: NavItem[], currentPath: string, trail: NavItem[]): NavItem[] | null {
  for (const item of items) {
    if (item.href && normalizePath(item.href) === normalizePath(currentPath)) {
      return [...trail, item];
    }
    if (item.children) {
      const found = findBreadcrumbs(item.children, currentPath, [...trail, item]);
      if (found) return found;
    }
  }
  return null;
}

function normalizePath(p: string): string {
  // Ensure trailing slash for comparison
  return p.endsWith('/') ? p : p + '/';
}

export function getBreadcrumbs(currentPath: string): NavItem[] {
  const items = getNavItems();
  return findBreadcrumbs(items, currentPath, []) || [];
}

export function isActiveOrAncestor(item: NavItem, currentPath: string): boolean {
  if (item.href && normalizePath(item.href) === normalizePath(currentPath)) {
    return true;
  }
  if (item.children) {
    return item.children.some((child) => isActiveOrAncestor(child, currentPath));
  }
  return false;
}
