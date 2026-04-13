#!/usr/bin/env node
/**
 * Feature QA script: Reply button alignment test.
 *
 * Runs both control and changed phases in a single invocation:
 *   Phase 1 (control): screenshot with reply buttons left-aligned (default)
 *   Phase 2 (changed): inject CSS to right-align, screenshot, diff against control
 *
 * The CSS injection approach means we don't need to rebuild the Docker image —
 * we override styles at runtime via page.evaluate, which is exactly how a QA
 * agent would test a proposed change before it ships.
 */

import { createCrucibleServer } from '../src/server.mjs';
import { diffPngs } from '../src/diff/pixelmatch.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const BASE_URL = 'http://localhost:3000';
const DOC_URL = `${BASE_URL}/docs/projects/sample/design/`;
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'crucible', 'screenshots');
const PROJECT = 'foundry';

const RIGHT_ALIGN_CSS = `
  .thread-comment-reply-btn { margin-left: auto; }
  .thread-reply-btn-bottom { margin-left: auto; }
`;

async function savePng(png, label) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOT_DIR, `reply-btn-${label}-${Date.now()}.png`);
  await fs.writeFile(filePath, png);
  return filePath;
}

async function setupPage(session) {
  // Navigate, set auth token, reload so annotations load
  await session.driver.navigate(DOC_URL, { waitUntil: 'networkidle' });
  await session.driver.evaluate("localStorage.setItem('foundry_token', 'dev')");
  await session.driver.navigate(DOC_URL, { waitUntil: 'networkidle' });
  await new Promise((r) => setTimeout(r, 2000)); // wait for annotations to render

  // Expand the Architecture thread
  await session.driver.click('.thread-replies-toggle', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 1000)); // wait for expansion

  // Scroll the review panel to the top so both phases have the same viewport
  await session.driver.evaluate(`
    const panel = document.querySelector('.thread-panel');
    if (panel) panel.scrollTop = 0;
    window.scrollTo(0, 0);
  `);
  await new Promise((r) => setTimeout(r, 500));
}

async function main() {
  console.log('\n  Feature QA: Reply Button Alignment\n');
  console.log('  ═══════════════════════════════════\n');

  const { session, shutdown } = createCrucibleServer();

  try {
    // ── Phase 1: Control ──────────────────────────────────────
    console.log('  PHASE 1: Control (reply buttons left-aligned)\n');

    await setupPage(session);

    console.log('  Taking control screenshot...');
    const control = await session.driver.screenshotPage({ fullPage: false });
    const controlPath = await savePng(control.png, 'control');
    console.log(`  ✓ Control: ${controlPath}`);

    console.log('');

    // ── Phase 2: Changed ──────────────────────────────────────
    console.log('  PHASE 2: Changed (reply buttons right-aligned)\n');

    // Inject the CSS change
    console.log('  Injecting right-align CSS...');
    await session.driver.evaluate(`
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(RIGHT_ALIGN_CSS)};
      document.head.appendChild(style);
    `);
    await new Promise((r) => setTimeout(r, 500));
    console.log('  ✓ CSS injected');

    console.log('  Taking changed screenshot...');
    const changed = await session.driver.screenshotPage({ fullPage: false });
    const changedPath = await savePng(changed.png, 'changed');
    console.log(`  ✓ Changed: ${changedPath}`);

    // ── Diff ──────────────────────────────────────────────────
    console.log('\n  DIFF: Comparing control vs changed...\n');

    const diff = await diffPngs(changed.png, control.png);
    const pct = ((1 - diff.matchScore) * 100).toFixed(2);

    console.log(`  Match score:  ${diff.matchScore.toFixed(6)}`);
    console.log(`  Diff pixels:  ${diff.diffPixels} / ${diff.totalPixels} (${pct}%)`);
    console.log(`  Dimensions:   ${diff.width}x${diff.height}`);

    if (diff.diffPixels > 0) {
      // Save the diff image
      const diffPath = await savePng(diff.diffPng, 'diff');
      console.log(`  Diff image:   ${diffPath}`);
    }

    // ── Verdict ───────────────────────────────────────────────
    console.log('\n  ═══════════════════════════════════\n');
    if (diff.diffPixels > 100) {
      console.log('  VERDICT: CHANGE DETECTED ✓');
      console.log('  The reply button alignment change is visually detectable.');
      console.log('  Crucible can distinguish the control from the changed state.\n');
    } else {
      console.log('  VERDICT: NO VISIBLE CHANGE ✗');
      console.log('  The CSS injection may not have affected the rendered output.\n');
    }

  } finally {
    await shutdown();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
