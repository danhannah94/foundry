import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface PullResult {
  ref: string;
  changedFiles: string[];
  isInitialClone: boolean;
}

export class ContentFetcher {
  private contentDir: string;
  private repoUrl: string;
  private branch: string;
  private deployKeyPath: string | null;
  private pulling: boolean = false;

  constructor(options: {
    contentDir: string;
    repoUrl: string;
    branch: string;
    deployKeyPath?: string;
  }) {
    this.contentDir = options.contentDir;
    this.repoUrl = options.repoUrl;
    this.branch = options.branch;
    this.deployKeyPath = options.deployKeyPath || null;
  }

  private gitEnv(): Record<string, string> {
    const env = { ...process.env } as Record<string, string>;
    if (this.deployKeyPath) {
      env.GIT_SSH_COMMAND = `ssh -i ${this.deployKeyPath} -o StrictHostKeyChecking=no`;
    }
    return env;
  }

  private async git(args: string[], cwd?: string): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: cwd || this.contentDir,
      env: this.gitEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  }

  async getCurrentRef(): Promise<string | null> {
    if (!existsSync(join(this.contentDir, '.git'))) return null;
    try {
      return await this.git(['rev-parse', 'HEAD']);
    } catch {
      return null;
    }
  }

  async snapshotRef(): Promise<string | null> {
    return this.getCurrentRef();
  }

  async restoreRef(ref: string): Promise<void> {
    await this.git(['reset', '--hard', ref]);
    console.log(`[content-fetcher] Restored to ref: ${ref.substring(0, 8)}`);
  }

  async pull(): Promise<PullResult | null> {
    // Mutex — skip if already pulling
    if (this.pulling) {
      console.log('[content-fetcher] Pull already in progress, skipping');
      return null;
    }

    this.pulling = true;
    try {
      const isGitRepo = existsSync(join(this.contentDir, '.git'));

      if (!isGitRepo) {
        // Initial clone
        console.log(`[content-fetcher] Cloning ${this.repoUrl} (branch: ${this.branch})`);
        await execFileAsync('git', [
          'clone', '--depth', '1', '--branch', this.branch,
          this.repoUrl, this.contentDir
        ], { env: this.gitEnv(), maxBuffer: 10 * 1024 * 1024 });

        const ref = await this.git(['rev-parse', 'HEAD']);
        console.log(`[content-fetcher] Clone complete: ${ref.substring(0, 8)}`);

        return { ref, changedFiles: [], isInitialClone: true };
      }

      // Already cloned — fetch and diff
      const oldRef = await this.git(['rev-parse', 'HEAD']);

      await this.git(['fetch', 'origin', this.branch, '--depth', '1']);
      await this.git(['reset', '--hard', 'FETCH_HEAD']);

      const newRef = await this.git(['rev-parse', 'HEAD']);

      if (oldRef === newRef) {
        console.log('[content-fetcher] No changes');
        return { ref: newRef, changedFiles: [], isInitialClone: false };
      }

      // Get changed files
      let changedFiles: string[] = [];
      try {
        const diff = await this.git(['diff', '--name-only', oldRef, newRef]);
        changedFiles = diff.split('\n').filter(f => f.length > 0);
      } catch {
        // If diff fails (shallow clone), treat as full change
        changedFiles = [];
      }

      console.log(`[content-fetcher] Updated: ${oldRef.substring(0, 8)} → ${newRef.substring(0, 8)} (${changedFiles.length} files changed)`);

      return { ref: newRef, changedFiles, isInitialClone: false };
    } catch (error) {
      console.error('[content-fetcher] Pull failed:', error);
      throw error;
    } finally {
      this.pulling = false;
    }
  }
}
