import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FoundryConfig {
  sources?: Array<{
    repo: string;
    branch: string;
    paths: string[];
    access: string;
  }>;
  docsPath?: string;
}

/**
 * Walks up the directory tree to find the project root containing foundry.config.yaml
 */
function findProjectRoot(startDir: string): string {
  let current = startDir;

  while (current !== dirname(current)) {
    try {
      const configPath = join(current, 'foundry.config.yaml');
      readFileSync(configPath, 'utf8');
      return current;
    } catch {
      current = dirname(current);
    }
  }

  throw new Error('Could not find foundry.config.yaml in any parent directory');
}

/**
 * Reads and parses the foundry.config.yaml file
 */
function readFoundryConfig(): FoundryConfig {
  try {
    const projectRoot = findProjectRoot(__dirname);
    const configPath = join(projectRoot, 'foundry.config.yaml');
    const configFile = readFileSync(configPath, 'utf8');
    const config = yaml.load(configFile) as FoundryConfig;

    return config || {};
  } catch (error) {
    console.warn('Could not read foundry.config.yaml:', error);
    return {};
  }
}

/**
 * Gets the docs/content reading path (where Astro + Anvil look for markdown).
 * In Docker: CONTENT_DIR points to the docs subdirectory within the cloned repo.
 */
export function getDocsPath(): string {
  // CONTENT_DIR env var takes priority (canonical path in Docker)
  if (process.env.CONTENT_DIR) {
    return process.env.CONTENT_DIR;
  }

  const config = readFoundryConfig();
  if (config.docsPath) {
    return config.docsPath;
  }

  const projectRoot = findProjectRoot(__dirname);
  return join(projectRoot, 'packages/site/content/');
}

/**
 * Gets the clone target path (where ContentFetcher clones the repo).
 * In Docker: CONTENT_CLONE_DIR is the repo root; CONTENT_DIR is the docs subdir within it.
 * Locally: falls back to getDocsPath() (clone and read from same place).
 */
export function getCloneDir(): string {
  if (process.env.CONTENT_CLONE_DIR) {
    return process.env.CONTENT_CLONE_DIR;
  }
  // Local dev: clone and read from same directory
  return getDocsPath();
}

/**
 * Gets the full configuration
 */
export function getConfig(): FoundryConfig {
  return readFoundryConfig();
}