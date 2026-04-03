import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FSWatcher } from "fs";
import type { Anvil } from "@claymore-dev/anvil";

// Capture the watch callback so tests can simulate file events
let watchCallback: (event: string, filename: string | null) => void;
const mockWatcher = { close: vi.fn() } as unknown as FSWatcher;

vi.mock("fs", () => ({
  watch: vi.fn((_dir: string, _opts: any, cb: any) => {
    watchCallback = cb;
    return mockWatcher;
  }),
}));

import { startFileWatcher } from "../file-watcher.js";

function createMockAnvil(opts?: { withReindexFiles?: boolean }): Anvil {
  const anvil: any = {
    search: vi.fn(),
    getStatus: vi.fn(),
    getPage: vi.fn(),
    getSection: vi.fn(),
    listPages: vi.fn(),
    index: vi.fn().mockResolvedValue({ indexed: 10 }),
  };
  if (opts?.withReindexFiles !== false) {
    anvil.reindexFiles = vi.fn().mockResolvedValue({ reindexed: 2 });
  }
  return anvil as Anvil;
}

describe("file-watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should call reindexFiles on .md file change", async () => {
    const anvil = createMockAnvil();
    startFileWatcher("/content", anvil);

    watchCallback("change", "docs/page.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(anvil.reindexFiles).toHaveBeenCalledWith(["docs/page.md"]);
  });

  it("should ignore non-.md files", async () => {
    const anvil = createMockAnvil();
    startFileWatcher("/content", anvil);

    watchCallback("change", "image.png");
    watchCallback("change", "style.css");
    await vi.advanceTimersByTimeAsync(500);

    expect(anvil.reindexFiles).not.toHaveBeenCalled();
    expect(anvil.index).not.toHaveBeenCalled();
  });

  it("should ignore null filenames", async () => {
    const anvil = createMockAnvil();
    startFileWatcher("/content", anvil);

    watchCallback("change", null as any);
    await vi.advanceTimersByTimeAsync(500);

    expect(anvil.reindexFiles).not.toHaveBeenCalled();
  });

  it("should debounce multiple rapid changes into a single reindex", async () => {
    const anvil = createMockAnvil();
    startFileWatcher("/content", anvil);

    watchCallback("change", "a.md");
    await vi.advanceTimersByTimeAsync(200);
    watchCallback("change", "b.md");
    await vi.advanceTimersByTimeAsync(200);
    watchCallback("change", "c.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(anvil.reindexFiles).toHaveBeenCalledTimes(1);
    expect(anvil.reindexFiles).toHaveBeenCalledWith(
      expect.arrayContaining(["a.md", "b.md", "c.md"])
    );
  });

  it("should deduplicate the same file changed multiple times", async () => {
    const anvil = createMockAnvil();
    startFileWatcher("/content", anvil);

    watchCallback("change", "page.md");
    watchCallback("change", "page.md");
    watchCallback("change", "page.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(anvil.reindexFiles).toHaveBeenCalledTimes(1);
    expect(anvil.reindexFiles).toHaveBeenCalledWith(["page.md"]);
  });

  it("should fall back to full index() when reindexFiles is not available", async () => {
    const anvil = createMockAnvil({ withReindexFiles: false });
    startFileWatcher("/content", anvil);

    watchCallback("change", "page.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(anvil.index).toHaveBeenCalledTimes(1);
  });

  it("should handle reindex errors gracefully", async () => {
    const anvil = createMockAnvil();
    (anvil.reindexFiles as any).mockRejectedValue(new Error("index failed"));
    startFileWatcher("/content", anvil);

    watchCallback("change", "page.md");
    await vi.advanceTimersByTimeAsync(500);

    expect(console.error).toHaveBeenCalledWith(
      "[file-watcher] Reindex failed:",
      expect.any(Error)
    );
  });

  it("should return the FSWatcher instance", () => {
    const anvil = createMockAnvil();
    const watcher = startFileWatcher("/content", anvil);
    expect(watcher).toBe(mockWatcher);
  });
});
