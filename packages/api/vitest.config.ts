import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for @foundry/api.
 *
 * `setupFiles` is applied before each test file's modules load, so it
 * provides safe defaults for env vars the middleware / OAuth code
 * expects. Individual test files can override these with module-top
 * `process.env.X = '...'` assignments.
 *
 * `pool: 'forks'` runs each test file in a child_process.fork so that
 * `process.env` is not shared between files. The default `threads`
 * pool uses worker_threads, which share the process-global `process.env`
 * — test files that mutate env vars (e.g. oauth-register deletes
 * FOUNDRY_DCR_TOKEN in an afterEach) were leaking state into other
 * files' concurrent tests, producing rare cross-file flakes.
 */
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
  },
});
