import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diffPngs, diffPngFiles } from '../../src/diff/pixelmatch.mjs';

/**
 * Build a solid-color PNG buffer.
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number, number]} rgba
 */
function makePng(width, height, rgba = [255, 255, 255, 255]) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = rgba[0];
      png.data[idx + 1] = rgba[1];
      png.data[idx + 2] = rgba[2];
      png.data[idx + 3] = rgba[3];
    }
  }
  return PNG.sync.write(png);
}

/**
 * Build a PNG of the base color, with `changed` pixels (from top-left, row-major)
 * overwritten with a different color.
 */
function makePngWithChanges(width, height, base, overwrite, changed) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const linear = width * y + x;
      const [r, g, b, a] = linear < changed ? overwrite : base;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

describe('diffPngs', () => {
  it('returns zero diff for identical images', async () => {
    const a = makePng(8, 8, [255, 255, 255, 255]);
    const b = makePng(8, 8, [255, 255, 255, 255]);
    const result = await diffPngs(a, b);
    expect(result.width).toBe(8);
    expect(result.height).toBe(8);
    expect(result.diffPixels).toBe(0);
    expect(result.totalPixels).toBe(64);
    expect(result.matchScore).toBe(1);
    expect(result.threshold).toBe(0.1);
  });

  it('returns a small diff for slightly different images', async () => {
    const base = [255, 255, 255, 255];
    const red = [255, 0, 0, 255];
    const a = makePng(8, 8, base);
    const b = makePngWithChanges(8, 8, base, red, 3); // 3 of 64 pixels changed
    const result = await diffPngs(a, b);
    expect(result.diffPixels).toBeGreaterThan(0);
    expect(result.diffPixels).toBeLessThanOrEqual(3);
    expect(result.matchScore).toBeLessThan(1);
    expect(result.matchScore).toBeGreaterThan(0.9);
  });

  it('returns a low match score for completely different images', async () => {
    const a = makePng(8, 8, [0, 0, 0, 255]);
    const b = makePng(8, 8, [255, 255, 255, 255]);
    const result = await diffPngs(a, b);
    expect(result.diffPixels).toBe(64);
    expect(result.matchScore).toBe(0);
  });

  it('throws when dimensions differ, with both sizes in the message', async () => {
    const a = makePng(8, 8);
    const b = makePng(4, 8);
    await expect(diffPngs(a, b)).rejects.toThrow(/8x8.*4x8|4x8.*8x8/);
  });

  it('produces a diffPng that is a valid PNG with the same dimensions', async () => {
    const a = makePng(8, 8, [0, 0, 0, 255]);
    const b = makePng(8, 8, [255, 255, 255, 255]);
    const result = await diffPngs(a, b);
    expect(Buffer.isBuffer(result.diffPng)).toBe(true);
    const decoded = PNG.sync.read(result.diffPng);
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
  });

  it('respects opts.threshold and passes it through to pixelmatch', async () => {
    // A tiny color perturbation: pixelmatch's YIQ delta is tuned so that
    // a very loose threshold considers it a match, a strict one does not.
    const base = [128, 128, 128, 255];
    const nudged = [140, 128, 128, 255];
    const a = makePng(8, 8, base);
    const b = makePngWithChanges(8, 8, base, nudged, 64); // all pixels nudged

    const strict = await diffPngs(a, b, { threshold: 0.01 });
    const loose = await diffPngs(a, b, { threshold: 0.9 });

    expect(strict.threshold).toBe(0.01);
    expect(loose.threshold).toBe(0.9);
    // The same pixel delta should count as more diff under strict than loose.
    expect(strict.diffPixels).toBeGreaterThan(loose.diffPixels);

    // Identical images pass regardless of threshold.
    const same = makePng(8, 8, base);
    const r1 = await diffPngs(same, same, { threshold: 0 });
    const r2 = await diffPngs(same, same, { threshold: 1 });
    expect(r1.diffPixels).toBe(0);
    expect(r2.diffPixels).toBe(0);
  });
});

describe('diffPngFiles', () => {
  it('reads PNGs from disk and returns the same shape as diffPngs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crucible-diff-'));
    try {
      const aPath = join(dir, 'a.png');
      const bPath = join(dir, 'b.png');
      await writeFile(aPath, makePng(4, 4, [0, 0, 0, 255]));
      await writeFile(bPath, makePng(4, 4, [255, 255, 255, 255]));
      const result = await diffPngFiles(aPath, bPath);
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      expect(result.diffPixels).toBe(16);
      expect(result.matchScore).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
