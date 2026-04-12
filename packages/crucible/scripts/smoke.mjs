#!/usr/bin/env node
// Smoke test for Crucible v0.1 against the foundry test-env.
//
// Assumes the test-env is already running. Boot it with:
//   test-env/scripts/up.sh smoke 54321
//
// Usage:
//   node packages/crucible/scripts/smoke.mjs            # uses CRUCIBLE_TEST_ENV_URL or http://127.0.0.1:54321
//   PORT=54321 node packages/crucible/scripts/smoke.mjs
//
// Output: lands the first real baseline at
//   ~/.crucible/baselines/foundry/sample-doc/{baseline.png,meta.json}

import { createSession } from '../src/session.mjs';

const baseUrl =
  process.env.CRUCIBLE_TEST_ENV_URL ||
  (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : 'http://127.0.0.1:54321');

const targetPath = '/docs/projects/sample/design';
const targetUrl = baseUrl + targetPath;

const PROJECT = 'foundry';
const SPEC = 'sample-doc';

function log(msg) {
  process.stderr.write(`[crucible:smoke] ${msg}\n`);
}

async function main() {
  log(`target: ${targetUrl}`);

  // Quick reachability probe so we fail fast with a clear message.
  try {
    const res = await fetch(baseUrl + '/api/health');
    if (!res.ok) throw new Error(`health responded ${res.status}`);
  } catch (err) {
    log(`test-env unreachable at ${baseUrl}: ${err.message}`);
    log(`boot it with: test-env/scripts/up.sh smoke 54321`);
    process.exit(2);
  }

  const session = createSession();
  try {
    log('navigating...');
    const nav = await session.driver.navigate(targetUrl, { waitUntil: 'networkidle' });
    log(`navigated -> ${nav.url} (status ${nav.status})`);
    if (!nav.status || nav.status >= 400) {
      throw new Error(`bad nav status: ${nav.status}`);
    }

    log('screenshotting...');
    const { png, viewport, url } = await session.driver.screenshotPage({ fullPage: true });
    log(`captured ${png.length} bytes @ ${viewport?.width}x${viewport?.height}`);
    session.lastScreenshot = { png, viewport, url, capturedAt: new Date().toISOString() };

    const existing = await session.baselines.get(PROJECT, SPEC);
    if (existing) {
      log('baseline exists — comparing against it');
      const { diffPngs } = await import('../src/diff/pixelmatch.mjs');
      const diff = await diffPngs(png, existing.png);
      log(
        `matchScore=${diff.matchScore.toFixed(6)} diffPixels=${diff.diffPixels}/${diff.totalPixels}`,
      );
    } else {
      log('no existing baseline — writing first one');
      const { pngPath, metaPath } = await session.baselines.put(PROJECT, SPEC, {
        png,
        meta: {
          capturedAt: new Date().toISOString(),
          url,
          viewport,
          browser: session.config.browser,
          approvedBy: 'crucible-v0.1-smoke',
          note: 'first baseline from smoke.mjs against foundry test-env',
        },
      });
      log(`baseline written:`);
      log(`  ${pngPath}`);
      log(`  ${metaPath}`);
    }

    log('smoke OK');
  } finally {
    await session.shutdown();
  }
}

main().catch((err) => {
  log(`FATAL: ${err?.stack || err}`);
  process.exit(1);
});
