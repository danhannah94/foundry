# Crucible — Decisions Log

Build-first-document-after. Short entries as real decisions get made. This is the source of truth for what survived contact with the code — the design doc gets updated only after v0.1 is working.

## 2026-04-11 — Initial v0.1 "Eyes Only" scaffold

- **Package:** `@foundry/crucible` inside the foundry monorepo (npm workspace), not a new repo. Keeps iteration tight while the shape is still in flux. Rename to `@claymore-dev/crucible` at v1 publication.
- **Language:** Plain ESM `.mjs` + JSDoc. No TypeScript build step. Mirrors `test-env/seed/fixture.mjs` style from last session. Vitest still runs `.mjs` fine.
- **Four tools in v0.1:** `navigate`, `screenshot_page`, `compare_screenshots`, `approve_baseline` (stub). Everything else from the design doc's MCP Tool Surface is deferred to later versions.
- **No adapter YAML.** Test-env URL is hardcoded in `src/config.mjs`. Adapter format lands in v0.2+.
- **One browser per MCP session,** held in `src/session.mjs` module state. Lazy-launched on first `navigate`, torn down on process exit. No multi-context isolation yet.
- **Baseline path:** `~/.crucible/baselines/<project>/<spec>/{baseline.png,meta.json}`. Project and spec are both validated as single path segments (reject `..`, slashes, empty). Matches the design doc's security-model mitigation.
- **Integration tests spawn `bin/crucible-mcp.mjs` as a subprocess** and drive it via `StdioClientTransport` from `@modelcontextprotocol/sdk`. No mocks for the MCP layer — this is the eyes proof.
- **Delegated to sub-agents** (isolated, no architectural load): `src/diff/pixelmatch.mjs` and `src/baselines/store.mjs`, plus their unit tests. Everything else hand-written.
- **Level 3 live MCP validation deferred.** Adding Crucible to `~/.claude/mcp.json` requires a CC restart. Goal for this session is to get Crucible one config edit away from live, then stop.

## 2026-04-11 — What survived contact (post-v0.1-build)

The plan from the top of the session mostly survived. Notes on the parts that matter:

- **MCP SDK is 1.29.0** (much newer than I expected). `McpServer.registerTool(name, { description, inputSchema }, handler)` where `inputSchema` is a **ZodRawShape** (plain object of zod schemas, not `z.object(...)`) is the right shape. Don't wrap in `z.object`.
- **Tool errors come back as `{ isError: true, content: [...] }`, not a thrown promise** on the client side. The integration test initially asserted `rejects.toThrow()` and had to be rewritten to inspect `result.isError`. Worth remembering for every future MCP integration test.
- **`StdioClientTransport({ env })` does not inherit the parent env automatically.** Must pass `{ ...process.env, CRUCIBLE_BASELINE_ROOT: tmpRoot }` explicitly — otherwise `PATH` is stripped and node can't find its own binaries. `stderr: 'pipe'` keeps the subprocess's diagnostic output out of the test runner's output unless you want it.
- **Baseline-store sub-agent chose a conservative `^[A-Za-z0-9._-]+$` regex** for project/spec segments. Probably fine forever; revisit only if a real project name needs `@` or spaces.
- **Diff sub-agent made `matchScore` pixel-count-based** (`1 - diffPixels/totalPixels`) rather than pixelmatch's internal YIQ delta. Simple and explainable. The `compare_screenshots` tool layers its own `matchTolerance` (default 0.001 = 0.1%) on top to decide pass/fail — keeping policy out of the diff module.
- **One browser per MCP session via module state in `session.mjs`** turned out clean. No multi-handle concept needed yet; `teardown_project` and friends will get their own session model when the harness lands.
- **Foundry test-env renders pixel-deterministic** across consecutive boots — smoke test produced `matchScore=1.000000, diffPixels=0/2067200` on the second run against a fresh baseline from the first run. This matters a lot: it confirms the test-env's "deterministic seed" claim from last session is real enough for pixel-diff to be meaningful. If that had drifted even slightly, baseline management would have become a much harder problem for v0.2.
- **Smoke script assumes test-env is already booted,** rather than shelling out to `up.sh` itself. Keeps the script small and the boundaries clean; the user always knows exactly what's running. Fetches `/api/health` first and prints the boot command if not reachable.
- **v0.1 is one edit away from live MCP.** Adding this block to `~/.claude/mcp.json` and restarting Claude Code is all that's left:
  ```json
  "crucible": {
    "command": "node",
    "args": ["/Users/danhannah/Documents/Code/foundry/packages/crucible/bin/crucible-mcp.mjs"]
  }
  ```
- **Total test count:** 26 green (7 diff + 16 store + 3 integration). Integration test drives the full eyes flow — navigate → screenshot → compare (needs_review) → approve → compare (pass) — over real stdio MCP with no mocks.
- **Deferred to v0.2+** (captured here so we don't forget): Docker harness + `boot_project`/`teardown_project`, adapter YAML, spec runner, parallel isolation via `COMPOSE_PROJECT_NAME`, dynamic-content masking, baseline approval workflow beyond "overwrite," per-OS baseline segregation.
