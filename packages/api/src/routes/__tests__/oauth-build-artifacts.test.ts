// WHY THIS TEST EXISTS:
// During E12 S5 QA the server crashed at boot with ENOENT on dist/oauth/consent.html.
// tsc only processes .ts files — non-TS assets like HTML are silently dropped.
// This smoke test runs npm run build and asserts the artifact lands where the
// route handler expects it, closing the "unit tests pass but build output is
// wrong" loophole. Any future non-TS asset that gets forgotten will fail here.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, beforeAll, expect } from 'vitest';

const PKG_ROOT = join(__dirname, '../../..');
const ARTIFACT = join(PKG_ROOT, 'dist/oauth/consent.html');

describe('oauth build artifacts', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: PKG_ROOT, stdio: 'pipe' });
  }, 30000);

  it('copies consent.html into dist/oauth/', () => {
    expect(existsSync(ARTIFACT)).toBe(true);
  });

  it('consent.html contains expected template placeholders', () => {
    const content = readFileSync(ARTIFACT, 'utf-8');
    expect(content).toContain('{{CLIENT_NAME}}');
    expect(content).toContain('{{GITHUB_LOGIN}}');
    expect(content).toContain('{{SCOPE_ITEMS}}');
  });
}, 30000);
