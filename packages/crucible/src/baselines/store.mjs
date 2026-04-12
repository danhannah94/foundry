import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

function validateSegment(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${name}: must be a non-empty string (got ${JSON.stringify(value)})`);
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${name}: must not contain path separators (got ${JSON.stringify(value)})`);
  }
  if (value === '.' || value === '..') {
    throw new Error(`Invalid ${name}: must not be '.' or '..' (got ${JSON.stringify(value)})`);
  }
  if (!SEGMENT_RE.test(value)) {
    throw new Error(`Invalid ${name}: must match ${SEGMENT_RE} (got ${JSON.stringify(value)})`);
  }
}

function validatePair(project, spec) {
  validateSegment('project', project);
  validateSegment('spec', spec);
}

export function createBaselineStore({ rootDir } = {}) {
  const baseDir = rootDir ?? path.join(os.homedir(), '.crucible', 'baselines');

  function pathFor(project, spec) {
    validatePair(project, spec);
    const dir = path.join(baseDir, project, spec);
    return {
      dir,
      pngPath: path.join(dir, 'baseline.png'),
      metaPath: path.join(dir, 'meta.json'),
    };
  }

  async function has(project, spec) {
    const { pngPath } = pathFor(project, spec);
    try {
      await fs.access(pngPath);
      return true;
    } catch {
      return false;
    }
  }

  async function get(project, spec) {
    const { pngPath, metaPath } = pathFor(project, spec);
    try {
      const [png, metaRaw] = await Promise.all([
        fs.readFile(pngPath),
        fs.readFile(metaPath, 'utf8'),
      ]);
      return { png, meta: JSON.parse(metaRaw) };
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async function put(project, spec, { png, meta }) {
    const { dir, pngPath, metaPath } = pathFor(project, spec);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(pngPath, png);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return { pngPath, metaPath };
  }

  async function del(project, spec) {
    const { dir } = pathFor(project, spec);
    try {
      await fs.access(dir);
    } catch {
      return false;
    }
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }

  async function listProjectSpecs(project) {
    validateSegment('project', project);
    const projectDir = path.join(baseDir, project);
    let entries;
    try {
      entries = await fs.readdir(projectDir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw err;
    }
    const specs = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!SEGMENT_RE.test(entry.name)) continue;
      try {
        await fs.access(path.join(projectDir, entry.name, 'baseline.png'));
        specs.push(entry.name);
      } catch {
        // skip
      }
    }
    specs.sort();
    return specs;
  }

  async function list(project) {
    if (project !== undefined) {
      return listProjectSpecs(project);
    }
    let entries;
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw err;
    }
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!SEGMENT_RE.test(entry.name)) continue;
      const specs = await listProjectSpecs(entry.name);
      if (specs.length > 0) {
        result.push({ project: entry.name, specs });
      }
    }
    result.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
    return result;
  }

  return { has, get, put, list, delete: del, pathFor };
}
