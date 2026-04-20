/**
 * Global vitest setup — runs before every test file.
 *
 * Sets safe defaults for OAuth env vars so that middleware paths that
 * require them (e.g. WWW-Authenticate header construction in
 * packages/api/src/middleware/auth.ts) don't blow up in tests that
 * predate E12 and weren't written with an issuer in mind.
 *
 * Individual test files may override these before importing modules
 * under test — process.env assignments at the module top of a test
 * file run before this setup is applied on reload but tests that don't
 * care inherit these defaults.
 */

if (!process.env.FOUNDRY_OAUTH_ISSUER) {
  process.env.FOUNDRY_OAUTH_ISSUER = 'https://foundry.test';
}
