# @foundry/crucible

Project-agnostic test harness & visual regression MCP server. The full design lives in Foundry at `projects/crucible/design.md`; this package is the implementation.

**Status:** v0.1 — "Eyes Only". Four MCP tools, hardcoded to the foundry test-env. No harness, no spec runner, no adapters yet.

## Tools exposed

| Tool | Purpose |
|------|---------|
| `navigate` | Go to a URL in the headless browser session |
| `screenshot_page` | Capture the current full page as PNG |
| `compare_screenshots` | Diff a screenshot against a stored baseline (pixelmatch) |
| `approve_baseline` | Stub — records intent to accept a screenshot as baseline |

## Quick start

```bash
# From the foundry repo root:
npm install
npx playwright install chromium

# Unit tests
npm test -w @foundry/crucible

# Smoke test (requires test-env running)
test-env/scripts/up.sh smoke 54321
npm run smoke -w @foundry/crucible
```

## Wiring into Claude Code (next session)

One edit to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "crucible": {
      "command": "node",
      "args": ["/absolute/path/to/foundry/packages/crucible/bin/crucible-mcp.mjs"]
    }
  }
}
```

Then restart Claude Code to pick up the new MCP server.

## What's next

See `DECISIONS.md` for what's landed. Roadmap in the design doc: v0.2 brings the Docker harness and spec runner; v0.3 adds parallel isolation and the QA skill.
