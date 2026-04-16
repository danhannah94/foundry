# Crucible — Decisions Log

Build-first-document-after. Short entries as real decisions get made. This is the source of truth for what survived contact with the code — the design doc gets updated only after the code is working.

## 2026-04-16 (session 3) — Regression QA pipeline designed, built, and validated

Regression QA pipeline is operational. Design doc at `projects/crucible/regression-qa` in Foundry.

- **Sequential pipeline:** Feature QA runs first → baselines approved → regression QA runs. Eliminates drift classification — by the time regression runs, all baselines are current. Any drift = real regression.
- **Clone-in-container Docker build:** New `test-env/Dockerfile` clones the repo from GitHub inside the container. `qa.sh` no longer touches local git state — works with a dirty working tree. Fixtures pre-baked into the image.
- **Renamed scripts:** `qa-pr.sh` → `qa.sh`, `qa-pr-cleanup.sh` → `qa-cleanup.sh`. Scripts work for any branch, not just PRs.
- **Timestamp masking:** Review panel relative timestamps ("3 days ago") cause ~3-4% false positive drift. DOM text masking via `run_script` before screenshots eliminates this. Rule: only mask text content, never structural elements.
- **9 baselines:** Added `settings-modal`, `search-modal`, `sample-doc-dark-mode`. All captured against a fresh main build with timestamp masking.
- **`/qa-regression` skill:** Encapsulates the full pipeline — boot fresh container, spawn Sonnet sub-agent for the sweep, tear down, report. Self-contained and reproducible.
- **`review-panel-with-drafts` dimension mismatch:** Full-page height varies by ~14px depending on draft annotation timing. Not blocking — consider switching to viewport-only.

Policies locked in:
- Always boot a fresh test-env for regression (never reuse long-running containers)
- Regression agent does NOT approve baselines — any drift is a regression
- Document all masks applied in the report

## 2026-04-13 (session 2) — Agentic QA pipeline validated end-to-end

Crucible grew from 5 tools to 7, and the full feature-agent → QA-agent pipeline was validated twice against real PRs.

- **PR #131 (reply button alignment):** CSS-only. QA agent verified via `run_script` CSS injection against the running test-env. PASS.
- **PR #132 (inline draft editing):** Component change — required booting a fresh test-env from the PR branch. New scripts `qa-pr.sh` / `qa-pr-cleanup.sh` wrap the existing `up.sh` / `down.sh` so the agent only needs the branch name. Build is ~2:40 cold, faster with layer cache. QA agent booted, verified all 7 success criteria, posted 3 screenshots inline on the PR, tore down, restored branch. Orchestrator merged based on the visual evidence alone. PASS.

New tools: `run_script` (page.evaluate wrapper) and `click` (CSS selector). These make the harness layer real — the QA agent can set localStorage, inject CSS, expand threads, and interact with the UI before screenshotting.

Two policies locked in:
- **QA agents recommend baseline updates; orchestrator approves.** Prevents a bad change from self-approving its own ground truth.
- **Evidence to the PR only on PASS.** Failed QA iterations don't belong in durable PR history.

Published a `lean` plugin to `danhannah94/claymore-plugins` with /start, /stop, /reply, /update skills. PROCESS.md in the plugin deliberately excludes the agentic QA pipeline — lean is general-purpose, QA is Foundry-specific infrastructure.

## 2026-04-13 — Agentic QA reframe + v0.1.1 changes

Major session. Reframed Crucible from "test harness + visual regression" to "agentic QA framework." Key decisions:

- **Three-layer interaction model:** eyes (core) + harness (core) + generic browser (fallback). Apps with MCP tools get the best experience; browser fallback for apps without.
- **Two-agent QA model:** feature QA agent + regression QA agent run in parallel. Feature agent checks the specific change; regression agent sweeps all baselines.
- **Regression suite derived from baseline store:** `list_baselines` returns all baselines — that IS the regression suite. No manual curation.
- **Separate QA agent verifies implementation agent's work.** Independent verification, not self-review.
- **Screenshot save-to-file:** `screenshot_page` writes PNG to disk, returns `filePath` + metadata. No base64 in MCP response. Agents read the file to visually inspect.
- **QA report in markdown** with PASS/ISSUES_FOUND/NEEDS_HUMAN verdicts. 3-iteration retry limit before human escalation.
- **Scripted spec runner removed from architecture.** Agent uses judgment, not a script.

Code changes (uncommitted, on `crucible/v0.1-eyes`):
- `screenshot_page` now saves to `/tmp/crucible/screenshots/` and returns `filePath`
- New `list_baselines` tool added (5 tools total now)
- QA prompt templates created in `templates/`
- All 26 tests green

Full decision log with rationale: Foundry design doc `projects/crucible/design.md` → Decisions Log section.

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
