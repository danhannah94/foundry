import { readFileSync } from 'fs';
import yaml from 'js-yaml';

export interface NavPage {
  title: string;
  path: string;
  access: 'public' | 'private';
}

/**
 * Parse nav.yaml and flatten into a list of pages with access levels.
 * Walks the tree recursively, inheriting access from parent nodes.
 */
export function parseNavPages(navYamlPath: string): NavPage[] {
  const raw = readFileSync(navYamlPath, 'utf8');
  const tree = yaml.load(raw) as any[];

  const pages: NavPage[] = [];

  function walk(nodes: any[], parentAccess: 'public' | 'private') {
    for (const node of nodes) {
      const access = node.access || parentAccess;
      if (node.path) {
        pages.push({ title: node.title, path: node.path, access });
      }
      if (node.children) {
        walk(node.children, access);
      }
    }
  }

  walk(tree, 'public');
  return pages;
}
