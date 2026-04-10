import { describe, it, expect } from 'vitest';
import { parseSections, findSection, findDuplicateHeadings } from '../section-parser.js';

describe('parseSections', () => {
  it('parses simple headings with ancestor paths', () => {
    const md = [
      '# Title',
      '',
      '## Overview',
      'body',
      '### Details',
      'more body',
      '## Next',
      'tail',
    ];
    const sections = parseSections(md);
    expect(sections.map(s => s.headingPath)).toEqual([
      '# Title',
      '# Title > ## Overview',
      '# Title > ## Overview > ### Details',
      '# Title > ## Next',
    ]);
  });

  it('ignores # comments inside fenced bash code blocks', () => {
    const md = [
      '# Doc',
      '',
      '## Setup',
      '',
      '```bash',
      '# Create state bucket',
      'aws s3api create-bucket --bucket foo',
      '# Enable versioning',
      'aws s3api put-bucket-versioning',
      '```',
      '',
      '## Deploy',
      'deploy body',
    ];
    const sections = parseSections(md);
    const paths = sections.map(s => s.headingPath);
    // Only real headings should be parsed — no "# Create state bucket" etc.
    expect(paths).toEqual([
      '# Doc',
      '# Doc > ## Setup',
      '# Doc > ## Deploy',
    ]);
  });

  it('ignores headings in code blocks without language tag', () => {
    const md = [
      '# Top',
      '',
      '```',
      '# not a heading',
      '## also not',
      '```',
      '',
      '## Real',
    ];
    const sections = parseSections(md);
    expect(sections.map(s => s.headingPath)).toEqual([
      '# Top',
      '# Top > ## Real',
    ]);
  });

  it('handles multiple code fences correctly', () => {
    const md = [
      '## A',
      '```',
      '# fake1',
      '```',
      '## B',
      '```python',
      '# fake2',
      '```',
      '## C',
    ];
    const sections = parseSections(md);
    expect(sections.map(s => s.headingPath)).toEqual([
      '## A',
      '## B',
      '## C',
    ]);
  });

  it('computes bodyStart/bodyEnd correctly around code blocks', () => {
    const md = [
      '## A',
      '```bash',
      '# fake',
      '```',
      '## B',
    ];
    const sections = parseSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].headingLine).toBe(0);
    expect(sections[0].bodyEnd).toBe(4);
    expect(sections[1].headingLine).toBe(4);
  });
});

describe('parseSections — subtreeEnd', () => {
  it('subtreeEnd of a section with no children equals bodyEnd', () => {
    const md = [
      '# Doc',
      '',
      '## A',
      'a body',
      '',
      '## B',
      'b body',
    ];
    const sections = parseSections(md);
    const a = sections.find(s => s.headingPath === '# Doc > ## A')!;
    expect(a.subtreeEnd).toBe(a.bodyEnd);
    expect(a.subtreeEnd).toBe(5); // line of "## B"
  });

  it('subtreeEnd of a parent walks past all descendants to next sibling', () => {
    const md = [
      '# Doc',
      '',
      '## A',
      'a body',
      '',
      '### A1',
      'a1 body',
      '',
      '### A2',
      'a2 body',
      '',
      '## B',
      'b body',
    ];
    const sections = parseSections(md);
    const a = sections.find(s => s.headingPath === '# Doc > ## A')!;
    // bodyEnd stops at "### A1" (first child)
    expect(a.bodyEnd).toBe(5);
    // subtreeEnd walks past A1, A2 and lands at "## B"
    expect(a.subtreeEnd).toBe(11);
  });

  it('subtreeEnd of the last top-level section extends to end of file', () => {
    const md = [
      '# Doc',
      '',
      '## A',
      'a body',
      '',
      '## B',
      'b body',
      '',
      '### B1',
      'b1 body',
    ];
    const sections = parseSections(md);
    const b = sections.find(s => s.headingPath === '# Doc > ## B')!;
    expect(b.subtreeEnd).toBe(md.length); // EOF
  });

  it('subtreeEnd respects level boundaries — H3 only walks past deeper headings', () => {
    const md = [
      '# Doc',
      '',
      '## Parent',
      '',
      '### Target',
      'target body',
      '',
      '#### Deep Child',
      'deep body',
      '',
      '### Sibling',
      'sibling body',
    ];
    const sections = parseSections(md);
    const target = sections.find(s => s.headingPath === '# Doc > ## Parent > ### Target')!;
    // Walks past "#### Deep Child" (level 4 > 3), stops at "### Sibling" (level 3 == 3)
    expect(target.subtreeEnd).toBe(10); // line of "### Sibling"
  });
});

describe('findSection', () => {
  it('finds section by path', () => {
    const md = ['# Doc', '## A', 'body', '## B', 'body2'];
    const s = findSection(md, '# Doc > ## B');
    expect(s).not.toBeNull();
    expect(s!.headingLine).toBe(3);
  });

  it('returns null on no match and surfaces the path for callers', () => {
    const md = ['# Doc', '## A'];
    expect(findSection(md, '# Doc > ## Nope')).toBeNull();
  });

  it('throws on ambiguous paths', () => {
    const md = ['## Overview', 'x', '## Overview', 'y'];
    expect(() => findSection(md, '## Overview')).toThrow(/Ambiguous/);
  });

  it('does not match headings inside code fences', () => {
    const md = [
      '# Doc',
      '## Real',
      '```bash',
      '# Fake',
      '```',
    ];
    // "# Fake" should not be findable as a section
    expect(findSection(md, '# Fake')).toBeNull();
    expect(findSection(md, '# Doc > ## Real')).not.toBeNull();
  });
});

describe('findSection — short-form resolution', () => {
  it('resolves unambiguous short-form heading path', () => {
    const md = ['# Title', '## Overview', 'body', '## Architecture', '### Tech Stack', 'tech'];
    const s = findSection(md, '### Tech Stack');
    expect(s).not.toBeNull();
    expect(s!.headingPath).toBe('# Title > ## Architecture > ### Tech Stack');
  });

  it('resolves partial path (multiple levels)', () => {
    const md = ['# Title', '## Architecture', '### Tech Stack', 'tech'];
    const s = findSection(md, '## Architecture > ### Tech Stack');
    expect(s).not.toBeNull();
    expect(s!.headingPath).toBe('# Title > ## Architecture > ### Tech Stack');
  });

  it('throws on ambiguous short-form', () => {
    const md = ['# Doc', '## A', '### Details', 'x', '## B', '### Details', 'y'];
    expect(() => findSection(md, '### Details')).toThrow(/Ambiguous short-form/);
  });

  it('returns null when short-form matches nothing', () => {
    const md = ['# Doc', '## Overview'];
    expect(findSection(md, '### Nope')).toBeNull();
  });

  it('exact match takes priority over short-form', () => {
    // "## Overview" is both an exact match and a short-form suffix match
    const md = ['# Title', '## Overview', 'body'];
    // This should match via exact match path, not short-form
    const s = findSection(md, '# Title > ## Overview');
    expect(s).not.toBeNull();
    expect(s!.headingPath).toBe('# Title > ## Overview');
  });
});

describe('findDuplicateHeadings', () => {
  it('detects duplicates', () => {
    const md = ['## A', '## B', '## A'];
    const dupes = findDuplicateHeadings(md);
    expect(dupes.get('## A')).toBe(2);
    expect(dupes.has('## B')).toBe(false);
  });

  it('does not count heading-like lines inside code blocks', () => {
    const md = [
      '## Overview',
      '```',
      '## Overview',
      '```',
    ];
    const dupes = findDuplicateHeadings(md);
    expect(dupes.size).toBe(0);
  });
});
