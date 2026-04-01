/**
 * Extract clean heading text, stripping anchor links injected by rehype-autolink-headings.
 * 
 * rehype-autolink-headings adds <a> children to headings with aria-hidden="true"
 * or class="anchor", and sometimes appends visible text like "#" or "§".
 * Using element.textContent picks all of this up, causing heading path mismatches.
 * 
 * This function clones the heading, removes anchor elements, and returns the
 * remaining text content.
 */
export function getCleanHeadingText(heading: Element): string {
  const clone = heading.cloneNode(true) as Element;

  // Remove anchor links (rehype-autolink-headings patterns)
  clone.querySelectorAll('a.anchor, a[aria-hidden="true"], .heading-anchor').forEach(el => el.remove());

  // Also strip any remaining # or § link text artifacts
  return clone.textContent?.trim().replace(/[#§]+$/, '').trim() || '';
}
