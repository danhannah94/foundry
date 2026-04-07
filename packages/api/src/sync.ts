import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync } from 'fs';
import { join } from 'path';

const execFile = promisify(execFileCb);

const STAGING_DIR = '/tmp/foundry-sync';

export interface SyncOptions {
  contentDir: string;     // /data/docs/
  remoteUrl: string;      // git@github.com:user/repo.git or https URL
  branch?: string;        // default: 'main'
  deployKeyPath?: string; // SSH key for auth
}

export interface SyncResult {
  filesSync: number;
  commitHash: string;
  duration_ms: number;
}

/**
 * Build the env object for git commands, injecting GIT_SSH_COMMAND if a deploy key is configured.
 */
function gitEnv(deployKeyPath?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const keyPath = deployKeyPath || process.env.DEPLOY_KEY_PATH;
  if (keyPath) {
    env.GIT_SSH_COMMAND = `ssh -i ${keyPath} -o StrictHostKeyChecking=no`;
  }
  return env;
}

/**
 * Run a git command in the staging directory.
 */
async function git(
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv; cwd?: string },
): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd: opts?.cwd || STAGING_DIR,
    env: opts?.env || process.env,
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });
  return stdout.trim();
}

/**
 * Count files recursively in a directory (excluding .git).
 */
function countFiles(dir: string): number {
  let count = 0;
  if (!existsSync(dir)) return 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath);
    } else {
      count++;
    }
  }
  return count;
}

/**
 * Remove everything in a directory except .git/.
 */
function cleanStagingDir(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    rmSync(join(dir, entry.name), { recursive: true, force: true });
  }
}

/**
 * Push content from contentDir to a remote GitHub repo.
 *
 * Uses a temp staging directory so /data/docs/ stays clean.
 * Force-pushes — Foundry always wins on conflict.
 */
export async function syncToGithub(options: SyncOptions): Promise<SyncResult> {
  const start = Date.now();
  const { contentDir, remoteUrl, branch = 'main', deployKeyPath } = options;
  const env = gitEnv(deployKeyPath);

  // 1. Ensure staging dir exists
  mkdirSync(STAGING_DIR, { recursive: true });

  // 2. Init git repo if needed
  const gitDir = join(STAGING_DIR, '.git');
  if (!existsSync(gitDir)) {
    await git(['init'], { env });
    await git(['remote', 'add', 'origin', remoteUrl], { env });
    // Configure git identity for commits
    await git(['config', 'user.email', 'foundry-sync@claymore.dev'], { env });
    await git(['config', 'user.name', 'Foundry Sync'], { env });
  } else {
    // Update remote URL if it changed
    const currentUrl = await git(['remote', 'get-url', 'origin'], { env }).catch(() => '');
    if (currentUrl !== remoteUrl) {
      await git(['remote', 'set-url', 'origin', remoteUrl], { env });
    }
  }

  // 3. Clean staging dir (remove everything except .git)
  cleanStagingDir(STAGING_DIR);

  // 4. Copy content files to staging dir
  if (existsSync(contentDir)) {
    cpSync(contentDir, STAGING_DIR, { recursive: true });
  }

  // 5. Stage all changes
  await git(['add', '-A'], { env });

  // 6. Check if there are changes
  try {
    await git(['diff', '--cached', '--quiet'], { env });
    // No changes — exit 0 means nothing to commit
    return {
      filesSync: 0,
      commitHash: '',
      duration_ms: Date.now() - start,
    };
  } catch {
    // Non-zero exit = there are changes, continue
  }

  // 7. Commit
  const timestamp = new Date().toISOString();
  await git(['commit', '-m', `Foundry sync ${timestamp}`], { env });

  // 8. Force push
  await git(['push', '--force', 'origin', `HEAD:${branch}`], { env });

  // 9. Get commit hash
  const commitHash = await git(['rev-parse', 'HEAD'], { env });

  // 10. Count files
  const filesSync = countFiles(STAGING_DIR);

  return {
    filesSync,
    commitHash,
    duration_ms: Date.now() - start,
  };
}
