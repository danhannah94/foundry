import { readFile } from 'node:fs/promises';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const DEFAULT_THRESHOLD = 0.1;

/**
 * Diff two PNG buffers using pixelmatch.
 *
 * @param {Buffer} actualBuffer PNG-encoded bytes of the actual image.
 * @param {Buffer} expectedBuffer PNG-encoded bytes of the expected image.
 * @param {{ threshold?: number }} [opts]
 * @returns {Promise<{
 *   width: number,
 *   height: number,
 *   diffPixels: number,
 *   totalPixels: number,
 *   matchScore: number,
 *   threshold: number,
 *   diffPng: Buffer,
 * }>}
 */
export async function diffPngs(actualBuffer, expectedBuffer, opts = {}) {
  const actual = PNG.sync.read(actualBuffer);
  const expected = PNG.sync.read(expectedBuffer);

  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `Image dimensions differ: actual ${actual.width}x${actual.height} vs expected ${expected.width}x${expected.height}`,
    );
  }

  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const { width, height } = actual;
  const diff = new PNG({ width, height });

  const diffPixels = pixelmatch(
    actual.data,
    expected.data,
    diff.data,
    width,
    height,
    { threshold },
  );

  const totalPixels = width * height;
  const matchScore = totalPixels === 0 ? 1 : 1 - diffPixels / totalPixels;

  return {
    width,
    height,
    diffPixels,
    totalPixels,
    matchScore,
    threshold,
    diffPng: PNG.sync.write(diff),
  };
}

/**
 * File-based convenience wrapper around {@link diffPngs}.
 *
 * @param {string} actualPath
 * @param {string} expectedPath
 * @param {{ threshold?: number }} [opts]
 */
export async function diffPngFiles(actualPath, expectedPath, opts = {}) {
  return diffPngs(await readFile(actualPath), await readFile(expectedPath), opts);
}
