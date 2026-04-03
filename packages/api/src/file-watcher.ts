import { watch, type FSWatcher } from "fs";
import { relative } from "path";
import type { Anvil } from "@claymore-dev/anvil";

/**
 * Starts a file watcher on the content directory that auto-triggers
 * Anvil reindex when .md files change. Dev mode only.
 */
export function startFileWatcher(contentDir: string, anvil: Anvil): FSWatcher {
  const DEBOUNCE_MS = 500;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const changedFiles = new Set<string>();

  console.log(`👁 File watcher started on ${contentDir}`);

  const watcher = watch(contentDir, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith(".md")) return;

    changedFiles.add(filename);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const files = Array.from(changedFiles);
      changedFiles.clear();
      debounceTimer = null;

      console.log(`[file-watcher] Changed: ${files.join(", ")}`);
      reindex(anvil, files);
    }, DEBOUNCE_MS);
  });

  return watcher;
}

async function reindex(anvil: Anvil, files: string[]): Promise<void> {
  try {
    if (typeof anvil.reindexFiles === "function") {
      console.log(`[file-watcher] Delta reindexing ${files.length} file(s)`);
      await anvil.reindexFiles(files);
    } else {
      console.log("[file-watcher] reindexFiles not available, falling back to full reindex");
      await anvil.index();
    }
    console.log("[file-watcher] Reindex complete");
  } catch (error) {
    console.error("[file-watcher] Reindex failed:", error);
  }
}
