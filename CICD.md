# Foundry — CI/CD & Testing

How Foundry is tested, how to run the test suites, and how to add coverage for new features.

## Test Layers

Foundry has three layers of testing, each catching different classes of bugs:

| Layer | What it catches | Runtime | When to run |
|-------|-----------------|---------|-------------|
| **Unit tests** (vitest) | Logic bugs, parser edge cases, route handler contracts | ~1s | Every change |
| **Integration tests** (vitest + supertest) | Route wiring, auth middleware, DB interactions | ~1s | Every change |
| **Agent QA** (MCP friction test) | UX friction, tool description staleness, route precedence bugs, cross-cutting inconsistencies | ~8min | Before merging MCP tool changes |

Unit and integration tests verify *mechanics* — does `findSection()` return the right line index? Does `PUT /api/docs/:path/sections/:heading` return 404 with `available_headings`? They're fast, deterministic, and catch regressions.

Agent QA verifies *experience* — can an agent with only the tool descriptions accomplish a realistic workflow? It catches things unit tests can't, like:

- A greedy wildcard route swallowing a more specific route (route precedence bugs that are invisible in isolation)
- Tool descriptions that have gone stale and no longer match behavior
- Parameter names that don't match mental models
- Error messages that point at the wrong problem
- Missing affordances (e.g., "I want to move a section, how?")

## Running Unit + Integration Tests

```bash
# From the repo root
npm run test -w @foundry/api

# Or from packages/api
npx vitest run

# Run a specific file
npx vitest run src/routes/__tests__/doc-crud.test.ts

# Watch mode
npx vitest watch
```

Tests live in `packages/api/src/**/__tests__/*.test.ts`. They use vitest + supertest with a temp SQLite DB and temp content directory — no external dependencies, no network calls. Safe to run in parallel.

### Adding a test for a new feature

When you add or modify an MCP tool, write a test that:
1. Seeds a minimal document fixture
2. Exercises the tool via supertest against the Express router
3. Asserts both the response shape AND the on-disk result (for write tools)
4. Covers the happy path + at least one error case (usually 404 with `available_headings`)

Look at `src/routes/__tests__/doc-crud.test.ts` for the pattern. The `seedDoc()` helper and `beforeEach` fixture reset are the key reuse points.

## Running the Agent QA Integration Test

The agent QA test is a structured prompt that hands off to a sub-agent with Foundry MCP tools loaded. The sub-agent works through seven scenarios covering the full tool surface, tries intuitive approaches first (no source reading), and produces a friction report.

**Test prompt location:** [`packages/api/src/mcp/__tests__/agent-qa-prompt.md`](packages/api/src/mcp/__tests__/agent-qa-prompt.md)

### Prerequisites

- A running Foundry instance (local or deployed) with MCP tools accessible
- A Claude Code session (or compatible MCP client) connected to Foundry
- Write auth configured (`FOUNDRY_WRITE_TOKEN` or local bypass)

### How to run

1. **Load the prompt:** Read `packages/api/src/mcp/__tests__/agent-qa-prompt.md`
2. **Hand it off to a sub-agent** with access to the `mcp__foundry__*` tools. In Claude Code, use the `Agent` tool with the full prompt body as input. The sub-agent should have no prior context about the codebase — that's the point.
3. **Wait** — expect 6-10 minutes and 60-100 tool calls
4. **Review the friction report** — the sub-agent returns a structured report with severity-tagged friction points, a tool coverage matrix, and positive notes

### What the prompt tests

- **Scenario 1:** Document lifecycle (create, read, list, delete)
- **Scenario 2:** Section CRUD (update, insert, move, delete, read-one)
- **Scenario 3:** Content replacement via `create_doc(content=...)`
- **Scenario 4:** Annotation + review workflow (create, thread, submit, resolve, reopen, delete)
- **Scenario 5:** Search + reindex
- **Scenario 6:** Edge cases (bad paths, invalid levels, self-moves, H1 deletion, etc.)
- **Scenario 7:** Cleanup

Every tool in the MCP surface gets exercised at least once, and error paths get poked deliberately in Scenario 6.

### When to run

- **Before merging any PR that changes MCP tool definitions, handler logic, or route mounting**
- **Before deploying** to fly.dev if the deploy touches the API
- **Quarterly at minimum** to catch silent drift between tool descriptions and behavior

Agent QA is not a replacement for unit tests — it's complementary. Unit tests give you deterministic regression coverage; agent QA gives you unfiltered UX feedback. Run both.

### Interpreting the friction report

The report categorizes findings by severity:

- **Critical:** Tool is broken or unusable. Fix before merging.
- **Moderate:** Confusing but recoverable with trial and error. Fix in the same PR if reasonable, otherwise file an issue.
- **Minor:** Suboptimal UX, correct behavior but surprising. Usually a description/documentation fix.

A friction point is a data point, not a mandate. Some findings will be false positives (stale cache on the server, agent misunderstanding) or by-design (`reopen_annotation` returns to draft — documented but surprising to the agent). Triage each one: fix, document, or dismiss with rationale.

Round-to-round comparison is the most valuable signal. After shipping fixes, run the prompt again and confirm the friction count drops. If a friction point reappears, you regressed or the fix didn't land.

## Historical Context

Agent QA was introduced during the 2026-04-10 session (see `status/session-2026-04-10` in Foundry for the full log). Round 1 found 10 friction points including a **critical** Express route precedence bug (`GET /docs/:path/sections/:heading` was being swallowed by the greedy `GET /docs/:path(*)` wildcard in `docs.ts`). This bug was invisible to unit tests because they mount routers in isolation — only a full-stack test caught it. Round 2, after fixes, dropped the count to ~3 truly remaining points, all tracked in GitHub issues.

The methodology is cheap (~50K tokens per round, ~8 minutes wall clock), catches a class of bugs nothing else does, and gives a quantifiable quality signal (friction count) over releases. It's worth the recurring cost.

## TypeScript + Build Checks

Beyond tests, every PR should pass:

```bash
# Type check (no emit)
cd packages/api && npx tsc --noEmit

# Full build (produces dist/ for the Express server + MCP mount)
npm run build -w @foundry/api
```

MCP runs in-process behind the Express mount at `POST /mcp` (Streamable
HTTP transport). There is no separate child-process bridge to rebuild —
when the deployed API restarts, clients reconnect and pick up the new tool
schemas. In local dev, restart `packages/api` after changing tool
definitions and your MCP client will see the update on its next request.
