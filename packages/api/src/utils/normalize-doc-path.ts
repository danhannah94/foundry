/**
 * Normalize a doc_path so both URL-style paths (from the frontend) and
 * file-system paths (from the MCP tool) resolve to the same value.
 *
 * Frontend stores:  /docs/Race%20Strategy/sub-systems/deployment-access-control/
 * MCP sends:        Race Strategy/sub-systems/deployment-access-control.md
 *
 * Canonical form:   Race Strategy/sub-systems/deployment-access-control
 *   (decoded, no /docs/ prefix, no trailing slash, no .md extension)
 */
export function normalizeDocPath(raw: string): string {
  let p = decodeURIComponent(raw);
  p = p.replace(/^\/docs\//, '');
  p = p.replace(/\/+$/, '');
  p = p.replace(/\.md$/, '');
  return p;
}

