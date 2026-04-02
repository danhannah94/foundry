interface CacheEntry {
  html: string;
  frontmatter: Record<string, any>;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedPage(slug: string): CacheEntry | undefined {
  return cache.get(slug);
}

export function setCachedPage(slug: string, html: string, frontmatter: Record<string, any>): void {
  cache.set(slug, { html, frontmatter, cachedAt: Date.now() });
}

export function invalidateRoute(slug: string): boolean {
  return cache.delete(slug);
}

export function invalidateAll(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; routes: string[] } {
  return { size: cache.size, routes: Array.from(cache.keys()) };
}
