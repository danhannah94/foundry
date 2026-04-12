import { createPlaywrightDriver } from './driver/playwright.mjs';
import { createBaselineStore } from './baselines/store.mjs';
import { resolveConfig } from './config.mjs';

export function createSession({ config } = {}) {
  const cfg = config || resolveConfig();
  const driver = createPlaywrightDriver({ viewport: cfg.viewport });
  const baselines = createBaselineStore({ rootDir: cfg.baselineRoot });

  let lastScreenshot = null;

  async function shutdown() {
    await driver.close();
  }

  return {
    config: cfg,
    driver,
    baselines,
    get lastScreenshot() { return lastScreenshot; },
    set lastScreenshot(value) { lastScreenshot = value; },
    shutdown,
  };
}
