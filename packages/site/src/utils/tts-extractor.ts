export interface TtsSection {
  id: string;
  title: string;
  level: number;
  text: string;
  element: HTMLElement;
}

export interface ExtractOptions {
  includeCode?: boolean;
}

const HEADING_SELECTOR = "h2, h3, h4";

function getHeadingLevel(el: Element): number {
  return parseInt(el.tagName[1], 10);
}

function shouldSkip(el: Element, includeCode: boolean): boolean {
  if (el.classList?.contains("mermaid")) return true;
  if (!includeCode) {
    const tag = el.tagName?.toLowerCase();
    if (tag === "pre" || tag === "code") return true;
  }
  return false;
}

function extractTableText(table: HTMLTableElement): string {
  const rows: string[] = [];
  table.querySelectorAll("tr").forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll("th, td").forEach((cell) => {
      const t = (cell.textContent || "").trim();
      if (t) cells.push(t);
    });
    if (cells.length) rows.push(cells.join(", "));
  });
  return rows.join(". ");
}

function extractText(el: Element, includeCode: boolean): string {
  if (shouldSkip(el, includeCode)) return "";
  if (el.tagName?.toLowerCase() === "table") {
    return extractTableText(el as HTMLTableElement);
  }
  // For elements containing nested skippable elements, walk children
  const parts: string[] = [];
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      const t = (child.textContent || "").trim();
      if (t) parts.push(t);
    } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const childEl = child as Element;
      if (!shouldSkip(childEl, includeCode)) {
        if (childEl.tagName?.toLowerCase() === "table") {
          parts.push(extractTableText(childEl as HTMLTableElement));
        } else {
          const t = (childEl.textContent || "").trim();
          if (t) parts.push(t);
        }
      }
    }
  }
  return parts.join(" ");
}

/**
 * Extract ordered sections from a rendered doc container.
 * Each section = heading + content until next heading of same or higher level.
 */
export function extractSections(
  container: HTMLElement,
  options?: ExtractOptions,
): TtsSection[] {
  const includeCode = options?.includeCode ?? false;
  const headings = Array.from(container.querySelectorAll(HEADING_SELECTOR));
  if (headings.length === 0) return [];

  const sections: TtsSection[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i] as HTMLElement;
    const level = getHeadingLevel(heading);
    const nextHeadingLevel =
      i + 1 < headings.length ? getHeadingLevel(headings[i + 1]) : Infinity;

    // Collect content between this heading and the next heading of ≤ same level
    const textParts: string[] = [];
    let sibling = heading.nextElementSibling;

    while (sibling) {
      // Stop at next heading of same or higher (lower number) level
      if (sibling.matches(HEADING_SELECTOR)) {
        const sibLevel = getHeadingLevel(sibling);
        if (sibLevel <= level) break;
        // It's a sub-heading — also stop (it will be its own section)
        break;
      }

      const t = extractText(sibling, includeCode);
      if (t) textParts.push(t);
      sibling = sibling.nextElementSibling;
    }

    sections.push({
      id: heading.id || "",
      title: (heading.textContent || "").trim(),
      level,
      text: textParts.join(" "),
      element: heading,
    });
  }

  return sections;
}
