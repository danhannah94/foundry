import os from 'node:os';
import path from 'node:path';

export const DEFAULT_TEST_ENV_URL = 'http://127.0.0.1:54321';

export const DEFAULT_BASELINE_ROOT = path.join(os.homedir(), '.crucible', 'baselines');

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export const DEFAULT_BROWSER = 'chromium';

export function resolveConfig(env = process.env) {
  return {
    testEnvUrl: env.CRUCIBLE_TEST_ENV_URL || DEFAULT_TEST_ENV_URL,
    baselineRoot: env.CRUCIBLE_BASELINE_ROOT || DEFAULT_BASELINE_ROOT,
    viewport: DEFAULT_VIEWPORT,
    browser: DEFAULT_BROWSER,
  };
}
