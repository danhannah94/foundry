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
 * Gets the docs path from config or returns the default path
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
 * Gets the full configuration
 */
export function getConfig(): FoundryConfig {
  return readFoundryConfig();
}