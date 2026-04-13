# Regression QA — Foundry

## Regression Objective

Check all stored baselines for **foundry** to verify no visual regressions were introduced.

## How to Discover the Test Suite

Run `list_baselines(project: "foundry")` to get all stored baselines.

## How to Work

For each baseline returned by `list_baselines`:

1. Navigate to the baseline's URL
2. Screenshot the page (match fullPage to the baseline's dimensions — if height > viewport height, use fullPage: true)
3. Compare against the stored baseline using `compare_screenshots`
4. If pass: move on. If fail: visually inspect and report.

## Available Tools

**Crucible tools:**
- `navigate`, `screenshot_page`, `compare_screenshots`, `list_baselines`, `run_script`, `click`

**Note:** You do NOT have `approve_baseline`. Recommend baseline updates in your report — the orchestrator approves after review.

**Foundry MCP tools (if needed to reach page states):**
- `mcp__foundry__get_page` — read a doc page
- `mcp__foundry__list_pages` — list all docs

## Known Fragile Areas

- Review panel may show different annotation counts if test data changed between runs
- The test-env must be booted with the same seed data for baselines to match

## Verdict Rules

- All baselines match within tolerance: **PASS**
- Any baseline drifted unexpectedly: **ISSUES_FOUND**
- Uncertain whether drift is intentional: **NEEDS_HUMAN**
