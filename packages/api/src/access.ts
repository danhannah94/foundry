import { readFileSync } from 'fs';
import { join } from 'path';

interface AccessMap {
  [prefix: string]: 'public' | 'private';
}

let accessMap: AccessMap | null = null;

/**
 * Load .access.json from the content directory
 */
export function loadAccessMap(contentPath: string): AccessMap {
  try {
    const raw = readFileSync(join(contentPath, '.access.json'), 'utf-8');
    accessMap = JSON.parse(raw) as AccessMap;
    return accessMap;
  } catch {
    console.warn('⚠️ No .access.json found — all content treated as public');
    accessMap = {};
    return accessMap;
  }
}

/**
 * Get the current access map
 */
export function getAccessMap(): AccessMap {
  return accessMap || {};
}

/**
 * Resolve a doc path to its access level
 * docPath like "projects/routr/design" matches prefix "projects/"
 */
export function getAccessLevel(docPath: string): 'public' | 'private' {
  const map = getAccessMap();
  // Try longest prefix match first
  const prefixes = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (docPath.startsWith(prefix) || docPath === prefix.replace(/\/$/, '')) {
      return map[prefix];
    }
  }
  return 'public'; // default to public if no match
}