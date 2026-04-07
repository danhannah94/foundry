/**
 * Section parser for Foundry doc CRUD operations.
 *
 * Parses markdown into sections by heading, builds Anvil-style heading paths
 * (e.g., "## Architecture > ### Tech Stack"), and provides lookup/validation.
 */

export interface ParsedSection {
  headingLine: number;   // 0-based line index of the heading
  headingText: string;   // raw heading text (e.g., "## Overview")
  headingPath: string;   // Anvil-style path (e.g., "## Architecture > ### Tech Stack")
  level: number;         // heading level (1-6)
  bodyStart: number;     // first line after heading
  bodyEnd: number;       // line index of next heading (exclusive) or end of file
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Parse a single markdown line as a heading.
 * Returns null if the line is not a heading.
 */
function parseHeadingLine(line: string): { level: number; text: string } | null {
  const m = line.match(HEADING_RE);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

/**
 * Parse all sections from markdown lines.
 *
 * Builds Anvil-compatible heading paths where each heading carries its
 * ancestor context: "## Parent > ### Child > #### Grandchild".
 */
export function parseSections(lines: string[]): ParsedSection[] {
  const sections: ParsedSection[] = [];

  // Stack of ancestor headings for path construction.
  // Each entry: { level, prefix } where prefix is the "#" prefix string.
  const ancestors: { level: number; prefix: string; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseHeadingLine(lines[i]);
    if (!parsed) continue;

    const { level, text } = parsed;
    const prefix = '#'.repeat(level);
    const headingText = `${prefix} ${text}`;

    // Pop ancestors at the same level or deeper (a new H2 resets H3+ context)
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= level) {
      ancestors.pop();
    }

    // Build the heading path from ancestors + current
    const pathParts = [...ancestors.map(a => `${a.prefix} ${a.text}`), headingText];
    const headingPath = pathParts.join(' > ');

    sections.push({
      headingLine: i,
      headingText,
      headingPath,
      level,
      bodyStart: i + 1,
      bodyEnd: lines.length, // will be corrected below
    });

    // Push current heading onto ancestor stack
    ancestors.push({ level, prefix, text });
  }

  // Fix bodyEnd: each section ends where the next section starts
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].bodyEnd = sections[i + 1].headingLine;
  }

  return sections;
}

/**
 * Find a section by its Anvil-style heading path.
 *
 * Returns null if no match. Throws an Error if the heading path is ambiguous
 * (matches more than one section).
 */
export function findSection(lines: string[], headingPath: string): ParsedSection | null {
  const sections = parseSections(lines);
  const matches = sections.filter(s => s.headingPath === headingPath);

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous heading path "${headingPath}" matches ${matches.length} sections. ` +
      `Duplicate headings at lines: ${matches.map(m => m.headingLine + 1).join(', ')}`
    );
  }

  return matches[0];
}

/**
 * Find all heading paths that appear more than once.
 * Returns a map of headingPath -> count (only entries with count > 1).
 */
export function findDuplicateHeadings(lines: string[]): Map<string, number> {
  const sections = parseSections(lines);
  const counts = new Map<string, number>();

  for (const s of sections) {
    counts.set(s.headingPath, (counts.get(s.headingPath) || 0) + 1);
  }

  // Keep only duplicates
  for (const [key, count] of counts) {
    if (count <= 1) counts.delete(key);
  }

  return counts;
}
