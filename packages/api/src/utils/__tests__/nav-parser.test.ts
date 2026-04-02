import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseNavPages } from '../nav-parser.js';

const tempDir = mkdtempSync(join(tmpdir(), 'nav-parser-test-'));

function writeTempYaml(content: string): string {
  const path = join(tempDir, `nav-${Date.now()}.yaml`);
  writeFileSync(path, content, 'utf8');
  return path;
}

afterAll(() => {
  try {
    const { readdirSync } = require('fs');
    for (const f of readdirSync(tempDir)) {
      unlinkSync(join(tempDir, f));
    }
    require('fs').rmdirSync(tempDir);
  } catch {
    // ignore cleanup errors
  }
});

describe('parseNavPages', () => {
  it('should parse flat pages with default public access', () => {
    const path = writeTempYaml(`
- title: Home
  path: index.md
- title: About
  path: about.md
`);

    const pages = parseNavPages(path);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ title: 'Home', path: 'index.md', access: 'public' });
    expect(pages[1]).toEqual({ title: 'About', path: 'about.md', access: 'public' });
  });

  it('should skip container nodes without paths', () => {
    const path = writeTempYaml(`
- title: Section
  children:
    - title: Page
      path: section/page.md
`);

    const pages = parseNavPages(path);
    expect(pages).toHaveLength(1);
    expect(pages[0].title).toBe('Page');
  });

  it('should inherit access from parent nodes', () => {
    const path = writeTempYaml(`
- title: Public Page
  path: public.md
- title: Private Section
  access: private
  children:
    - title: Secret Page
      path: secret.md
    - title: Inner Section
      children:
        - title: Deep Secret
          path: deep-secret.md
`);

    const pages = parseNavPages(path);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toEqual({ title: 'Public Page', path: 'public.md', access: 'public' });
    expect(pages[1]).toEqual({ title: 'Secret Page', path: 'secret.md', access: 'private' });
    expect(pages[2]).toEqual({ title: 'Deep Secret', path: 'deep-secret.md', access: 'private' });
  });

  it('should allow child to override parent access', () => {
    const path = writeTempYaml(`
- title: Private Section
  access: private
  children:
    - title: Public Override
      access: public
      path: override.md
    - title: Still Private
      path: still-private.md
`);

    const pages = parseNavPages(path);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ title: 'Public Override', path: 'override.md', access: 'public' });
    expect(pages[1]).toEqual({ title: 'Still Private', path: 'still-private.md', access: 'private' });
  });

  it('should handle deeply nested structures', () => {
    const path = writeTempYaml(`
- title: Root
  children:
    - title: Level 1
      children:
        - title: Level 2
          children:
            - title: Deep Page
              path: deep/page.md
`);

    const pages = parseNavPages(path);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual({ title: 'Deep Page', path: 'deep/page.md', access: 'public' });
  });

  it('should return empty array for empty nav', () => {
    const path = writeTempYaml(`[]`);
    const pages = parseNavPages(path);
    expect(pages).toEqual([]);
  });
});
