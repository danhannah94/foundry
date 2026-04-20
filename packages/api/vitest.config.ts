import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for @foundry/api.
 *
 * `setupFiles` is applied before each test file's modules load, so it
 * provides safe defaults for env vars the middleware / OAuth code
 * expects. Individual test files can override these with module-top
 * `process.env.X = '...'` assignments.
 */
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
});
