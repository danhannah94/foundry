import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

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
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  if (filePath === 'index.md') return base + '/';
  // Strip leading docs/ prefix — build.sh already strips this when copying content
  const normalizedPath = filePath.replace(/^docs\//, '');
  return base + '/docs/' + normalizedPath.replace(/\.md$/, '') + '/';
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

let cachedNav: NavItem[] | null = null;

export function getNavItems(): NavItem[] {
  if (cachedNav) return cachedNav;

  const navPath = path.resolve(process.cwd(), '../../nav.yaml');
  const raw = fs.readFileSync(navPath, 'utf-8');
  const parsed = yaml.load(raw) as RawNavItem[];
  cachedNav = processItems(parsed);
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
