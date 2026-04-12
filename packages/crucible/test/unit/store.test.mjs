import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBaselineStore } from '../../src/baselines/store.mjs';

const fakePng = (tag = 0) =>
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag & 0xff, 0x01, 0x02, 0x03]);

const fakeMeta = (overrides = {}) => ({
  capturedAt: '2026-04-11T00:00:00.000Z',
  viewport: { width: 1280, height: 720 },
  browser: 'chromium',
  approvedBy: 'test',
  ...overrides,
});

let rootDir;
let store;

beforeAll(async () => {
  const unique = `crucible-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  rootDir = path.join(os.tmpdir(), unique);
  await fs.mkdir(rootDir, { recursive: true });
  store = createBaselineStore({ rootDir });
});

afterAll(async () => {
  if (rootDir) {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

describe('createBaselineStore', () => {
  it('put then get roundtrip preserves png bytes and meta', async () => {
    const png = fakePng(1);
    const meta = fakeMeta();
    const { pngPath, metaPath } = await store.put('proj-a', 'spec-1', { png, meta });
    expect(pngPath).toContain(path.join('proj-a', 'spec-1', 'baseline.png'));
    expect(metaPath).toContain(path.join('proj-a', 'spec-1', 'meta.json'));

    const got = await store.get('proj-a', 'spec-1');
    expect(got).not.toBeNull();
    expect(Buffer.isBuffer(got.png)).toBe(true);
    expect(got.png.equals(png)).toBe(true);
    expect(got.meta).toEqual(meta);
  });

  it('has returns false before put, true after', async () => {
    expect(await store.has('proj-has', 'alpha')).toBe(false);
    await store.put('proj-has', 'alpha', { png: fakePng(2), meta: fakeMeta() });
    expect(await store.has('proj-has', 'alpha')).toBe(true);
  });

  it('get on missing spec returns null', async () => {
    const got = await store.get('proj-missing', 'nope');
    expect(got).toBeNull();
  });

  it('list() with no arg returns [] on empty store', async () => {
    const emptyRoot = path.join(rootDir, 'empty-sub');
    await fs.mkdir(emptyRoot, { recursive: true });
    const emptyStore = createBaselineStore({ rootDir: emptyRoot });
    expect(await emptyStore.list()).toEqual([]);
    expect(await emptyStore.list('anything')).toEqual([]);
  });

  it("list('proj') returns spec names after puts", async () => {
    await store.put('proj-list', 's1', { png: fakePng(3), meta: fakeMeta() });
    await store.put('proj-list', 's2', { png: fakePng(4), meta: fakeMeta() });
    const specs = await store.list('proj-list');
    expect(specs).toEqual(['s1', 's2']);
  });

  it('list() returns all project/spec pairs across multiple projects', async () => {
    const subRoot = path.join(rootDir, 'multi');
    await fs.mkdir(subRoot, { recursive: true });
    const s = createBaselineStore({ rootDir: subRoot });
    await s.put('alpha', 'one', { png: fakePng(5), meta: fakeMeta() });
    await s.put('alpha', 'two', { png: fakePng(6), meta: fakeMeta() });
    await s.put('beta', 'only', { png: fakePng(7), meta: fakeMeta() });
    const all = await s.list();
    expect(all).toEqual([
      { project: 'alpha', specs: ['one', 'two'] },
      { project: 'beta', specs: ['only'] },
    ]);
  });

  it('delete returns true for existing, false for missing, and clears has()', async () => {
    await store.put('proj-del', 'gone', { png: fakePng(8), meta: fakeMeta() });
    expect(await store.has('proj-del', 'gone')).toBe(true);
    expect(await store.delete('proj-del', 'gone')).toBe(true);
    expect(await store.has('proj-del', 'gone')).toBe(false);
    expect(await store.delete('proj-del', 'gone')).toBe(false);
    expect(await store.delete('proj-del', 'never-existed')).toBe(false);
  });

  describe('path traversal validation', () => {
    const payload = { png: fakePng(0), meta: fakeMeta() };

    it("rejects '..' as project", async () => {
      await expect(store.put('..', 'x', payload)).rejects.toThrow(/project/);
    });

    it("rejects '../evil' as spec", async () => {
      await expect(store.put('ok', '../evil', payload)).rejects.toThrow(/spec/);
    });

    it("rejects 'a/b' as project (slash)", async () => {
      await expect(store.put('a/b', 'x', payload)).rejects.toThrow(/project/);
    });

    it('rejects empty project', async () => {
      await expect(store.put('', 'x', payload)).rejects.toThrow(/project/);
    });

    it('rejects backslash in spec', async () => {
      await expect(store.put('ok', 'a\\b', payload)).rejects.toThrow(/spec/);
    });

    it("rejects '.' as spec", async () => {
      await expect(store.put('ok', '.', payload)).rejects.toThrow(/spec/);
    });

    it('has/get/delete also reject invalid segments', async () => {
      await expect(store.has('..', 'x')).rejects.toThrow();
      await expect(store.get('ok', '../y')).rejects.toThrow();
      await expect(store.delete('', 'x')).rejects.toThrow();
    });
  });

  describe('pathFor', () => {
    it('returns paths under rootDir and has no fs side effects', async () => {
      const before = await fs.readdir(rootDir);
      const p = store.pathFor('pf-proj', 'pf-spec');
      expect(p.dir).toBe(path.join(rootDir, 'pf-proj', 'pf-spec'));
      expect(p.pngPath).toBe(path.join(rootDir, 'pf-proj', 'pf-spec', 'baseline.png'));
      expect(p.metaPath).toBe(path.join(rootDir, 'pf-proj', 'pf-spec', 'meta.json'));
      const after = await fs.readdir(rootDir);
      expect(after).toEqual(before);
      // called twice, same result (pure)
      expect(store.pathFor('pf-proj', 'pf-spec')).toEqual(p);
    });

    it('pathFor rejects invalid segments too', () => {
      expect(() => store.pathFor('..', 'x')).toThrow(/project/);
      expect(() => store.pathFor('ok', '../y')).toThrow(/spec/);
    });
  });
});
