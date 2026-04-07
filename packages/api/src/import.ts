import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, mkdirSync, copyFileSync, readdirSync, statSync, existsSync, rmSync } from 'fs';
import { join, relative, dirname } from 'path';
import { createHash } from 'crypto';
import matter from 'gray-matter';
import { getDb } from './db.js';
import { getAccessLevel, loadAccessMap } from './access.js';

const execFileAsync = promisify(execFile);

export interface ImportOptions {
  repoUrl: string;
  branch?: string;       // default: 'main'
  prefix?: string;       // default: 'docs/'
  contentDir: string;    // target: /data/docs/
  dbPath?: string;       // for docs_meta population (sets env before getDb)
}

export interface ImportResult {
  filesImported: number;
  docsMetaUpdated: number;
  duration_ms: number;
}

/**
 * Recursively find all .md files under a directory.
 */
function walkMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkMdFiles(fullPath));
    } else if (entry.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extract title from markdown content.
 * Checks frontmatter `title` first, then first H1 heading.
 */
function extractTitle(content: string, filePath: string): string {
  const parsed = matter(content);

  // Frontmatter title
  if (parsed.data?.title) {
    return parsed.data.title;
  }

  // First H1
  const h1Match = parsed.content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Fallback to filename without extension
  const parts = filePath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}

/**
 * Import docs from a GitHub repo into the content directory and populate docs_meta.
 *
 * Shared core logic used by both the CLI and the Express route.
 */
export async function importFromRepo(options: ImportOptions): Promise<ImportResult> {
  const {
    repoUrl,
    branch = 'main',
    prefix = 'docs/',
    contentDir,
    dbPath,
  } = options;

  // Set dbPath env if provided (for CLI usage outside the server)
  if (dbPath) {
    process.env.FOUNDRY_DB_PATH = dbPath;
  }

  const startTime = Date.now();
  const tempDir = `/tmp/foundry-import-${Date.now()}/`;

  try {
    // 1. Clone the repo (shallow, single branch)
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (process.env.DEPLOY_KEY_PATH) {
      env.GIT_SSH_COMMAND = `ssh -i ${process.env.DEPLOY_KEY_PATH} -o StrictHostKeyChecking=no`;
    }

    await execFileAsync('git', [
      'clone', '--depth', '1', '--branch', branch, repoUrl, tempDir,
    ], { env });

    // 2. Find all .md files under the prefix path
    const sourceDir = join(tempDir, prefix);
    const mdFiles = walkMdFiles(sourceDir);

    // 3. Ensure content directory exists
    mkdirSync(contentDir, { recursive: true });

    // 4. Copy .access.json if it exists in the source prefix
    const accessJsonSource = join(sourceDir, '.access.json');
    if (existsSync(accessJsonSource)) {
      copyFileSync(accessJsonSource, join(contentDir, '.access.json'));
    }

    // Load access map for determining access levels
    loadAccessMap(contentDir);

    // 5. Process each markdown file
    const db = getDb();
    const upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO docs_meta (path, title, access, content_hash, modified_at, modified_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'system', COALESCE(
        (SELECT created_at FROM docs_meta WHERE path = ?),
        ?
      ))
    `);

    let filesImported = 0;
    let docsMetaUpdated = 0;
    const now = new Date().toISOString();

    const upsertMany = db.transaction((files: string[]) => {
      for (const filePath of files) {
        const relPath = relative(sourceDir, filePath);
        const destPath = join(contentDir, relPath);

        // Create subdirectories as needed
        mkdirSync(dirname(destPath), { recursive: true });

        // Copy file
        copyFileSync(filePath, destPath);
        filesImported++;

        // Extract metadata
        const content = readFileSync(filePath, 'utf-8');
        const title = extractTitle(content, relPath);
        const contentHash = createHash('sha256').update(content).digest('hex');

        // Doc path for docs_meta: strip .md extension
        const docPath = relPath.replace(/\.md$/, '');
        const access = getAccessLevel(docPath);

        // Upsert into docs_meta
        upsertStmt.run(docPath, title, access, contentHash, now, docPath, now);
        docsMetaUpdated++;
      }
    });

    upsertMany(mdFiles);

    const duration_ms = Date.now() - startTime;
    return { filesImported, docsMetaUpdated, duration_ms };
  } finally {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
}
