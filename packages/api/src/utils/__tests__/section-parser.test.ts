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
