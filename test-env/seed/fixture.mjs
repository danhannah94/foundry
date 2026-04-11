#!/usr/bin/env node
// Foundry test env seed script.
//
// Populates a fresh test instance with deterministic annotations via the real
// API. Assumes markdown fixtures have already been copied into /data/docs and
// the container is healthy. Dev-mode auth (no tokens) is required — set by the
// test-env compose override.
//
// Required env:
//   FOUNDRY_BASE_URL — e.g., http://localhost:54321

const BASE = process.env.FOUNDRY_BASE_URL;
if (!BASE) {
  console.error('FOUNDRY_BASE_URL is required');
  process.exit(1);
}

const DOC_PATH = 'projects/sample/design.md';

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function createAnnotation(fields) {
  return api('POST', '/api/annotations', {
    doc_path: DOC_PATH,
    author_type: 'human',
    ...fields,
  });
}

async function main() {
  console.log(`  base: ${BASE}`);
  console.log(`  doc:  ${DOC_PATH}`);

  // 1. Top-level on Overview — exercises the "single top-level comment" state
  const a1 = await createAnnotation({
    heading_path: '## Overview',
    content: 'This section sets the stage. Consider adding a **one-line pitch** at the top for scannability.',
    quoted_text: 'Sample Design Doc',
    status: 'submitted',
  });
  console.log(`  ✓ a1 (top-level on Overview):      ${a1.id}`);

  // 2. Top-level on Architecture — will become the root of a reply thread
  const a2 = await createAnnotation({
    heading_path: '## Architecture',
    content: 'What are the *boundaries* between the layers here? The current prose is a bit hand-wavy.',
    quoted_text: 'Architecture',
    status: 'submitted',
  });
  console.log(`  ✓ a2 (top-level on Architecture):  ${a2.id}`);

  // 3. Reply to a2 — AI author, exercises the threaded-reply render path
  const a3 = await createAnnotation({
    author_type: 'ai',
    heading_path: '## Architecture',
    parent_id: a2.id,
    content:
      'Good question. The architecture has three layers:\n\n' +
      '- **Frontend**: site + review panel\n' +
      '- **API**: Express + SQLite\n' +
      '- **MCP**: stdio protocol for agent access',
    status: 'submitted',
  });
  console.log(`  ✓ a3 (reply to a2):                ${a3.id}`);

  // 4. Reply-to-reply — exercises the flattened-descendant render path we
  //    intentionally designed for in PR #124's grouping code
  const a4 = await createAnnotation({
    heading_path: '## Architecture',
    parent_id: a3.id,
    content: 'Thanks — that helps. Where does auth fit into the API layer?',
    status: 'submitted',
  });
  console.log(`  ✓ a4 (reply to a3):                ${a4.id}`);

  // 5. Resolved — exercises the collapsed-resolved render path
  const a5 = await createAnnotation({
    heading_path: '## Open Questions',
    content: 'I figured this one out on my own — resolving.',
    status: 'resolved',
  });
  console.log(`  ✓ a5 (resolved on Open Questions): ${a5.id}`);

  console.log('');
  console.log('  seeded 5 annotations on', DOC_PATH);
}

main().catch((err) => {
  console.error('SEED FAILED:', err.message);
  process.exit(1);
});
