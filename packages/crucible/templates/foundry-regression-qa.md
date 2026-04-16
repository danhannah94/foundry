# Regression QA — Foundry

## Regression Objective

Check all stored baselines for **foundry** to verify no visual regressions were introduced. This runs after feature QA passed and baselines were approved — any drift is a real regression.

## Test Environment

**Always boot a fresh test-env for regression QA.** Do not use the long-running smoke instance — it may be running stale code. A fresh build from the target branch guarantees you're testing current code with clean seed data.

```bash
# Boot fresh test-env from main (or target branch)
cd /Users/danhannah/Documents/Code/foundry
test-env/scripts/qa.sh main
# Output includes the port — use that URL for all baselines
```

Wait for the health check to pass, then note the URL (e.g. `http://localhost:3042`). Use this URL for ALL baselines in the run — replace `http://localhost:3000` in the baseline catalog with the actual port.

**After the regression sweep completes, tear down:**
```bash
test-env/scripts/qa-cleanup.sh main
```

## How to Discover the Test Suite

Run `list_baselines(project: "foundry")` to get all stored baselines. If `baselines` were passed as a parameter, only check those.

## Baseline Catalog

Current baselines and how to reach each state:

| Spec | Auth | fullPage | Setup Steps |
|------|------|----------|-------------|
| `homepage` | No | false | Navigate to `/`. No setup needed. |
| `sample-doc` | No | false | Navigate to `/docs/projects/sample/design/`. No setup needed. |
| `sample-doc-full` | No | true | Navigate to `/docs/projects/sample/design/`. Screenshot with `fullPage: true`. |
| `review-panel-thread-expanded` | Yes | false | Authenticate, then click `.thread-replies-toggle` to expand the Architecture thread. |
| `review-panel-reply-buttons-right-aligned` | Yes | false | Authenticate. Reply buttons should be right-aligned by default. |
| `review-panel-with-drafts` | Yes | true | Authenticate. Create a draft annotation via `POST /api/annotations` with `{doc_path: 'projects/sample/design', heading_path: '## Overview', content: 'Test draft', author_type: 'human'}`. Reload page. Screenshot with `fullPage: true`. |
| `settings-modal` | Yes | false | Authenticate, then click `.settings-gear-btn` to open settings modal. |
| `search-modal` | Yes | false | Click `.search-modal__icon-button` to open search modal. |
| `sample-doc-dark-mode` | Yes | false | Authenticate, open settings, click the "Dark" `.settings-radio` label, close settings. |

## Authentication

The review panel requires a token. After each `navigate` (which resets page context):

```javascript
// run_script: open token modal and submit
// 1. Click the unlock button
click('.thread-auth-prompt button')
// 2. Modal opens — fill and submit via run_script:
run_script(`
  const input = document.querySelector('.token-modal__input');
  const submit = document.querySelector('.token-modal__submit');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'test-token');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  submit.click();
`)
```

**Efficiency tip:** Group baselines by auth state. Do all unauthenticated baselines first (`homepage`, `sample-doc`, `sample-doc-full`), then authenticate once and sweep all authenticated baselines without re-navigating when possible.

## Dynamic Content Masking

Apply BEFORE every screenshot on authenticated pages:

```javascript
// run_script: mask relative timestamps
document.querySelectorAll('.thread-comment-time, .thread-comment-timestamp, time')
  .forEach(el => { if (el.textContent.match(/ago|just now|yesterday|hours?|minutes?|days?|seconds?/i)) el.textContent = 'X ago'; });
```

**Why:** Seed data has fixed `created_at` dates. The UI renders relative timestamps ("3 days ago") that drift between sessions. This causes ~3-4% pixel diff on every authenticated baseline — false positives, not regressions.

**Rule:** Only mask text content. Never hide, remove, or resize elements. Document all masks in the report.

## Available Tools

**Crucible tools:**
- `navigate` — go to a URL (resets page context including auth)
- `screenshot_page` — capture a screenshot (fullPage: true for full-page baselines)
- `compare_screenshots` — diff against a stored baseline
- `list_baselines` — discover all baselines for foundry
- `run_script` — run JavaScript in the page (auth, masking, DOM state)
- `click` — click an element by CSS selector (modals, thread expansion)

**Note:** You do NOT have `approve_baseline`. Baselines were already approved before this run. Any drift is a regression.

**Foundry MCP tools (for page state if needed):**
- `mcp__foundry__get_page` — read a doc page
- `mcp__foundry__list_pages` — list all docs

**Test-env API (for data setup):**
- `POST /api/annotations` — create annotations (used for draft baseline setup)
- `GET /api/annotations?doc_path=...` — check existing annotations

## Known Fragile Areas

- **Relative timestamps** in review panel — ALWAYS mask before screenshotting (see above)
- **Homepage anti-aliasing** — may show ~0.5% drift from font rendering. Use `matchTolerance: 0.01` if default (0.001) fails and visual inspection shows no real difference.
- **Draft annotation** for `review-panel-with-drafts` — must be created fresh each run since the test-env doesn't persist drafts across context resets
- Review panel annotation counts may differ if test data was modified between runs
- The test-env must be booted with the same seed data for baselines to match

## Verdict Rules

- All baselines match within tolerance: **PASS**
- Any baseline drifted unexpectedly: **ISSUES_FOUND**
- Uncertain whether drift is a real regression: **NEEDS_HUMAN**

## QA Report Format

```
## Verdict: PASS | ISSUES_FOUND | NEEDS_HUMAN

## Baseline Results
| Spec | URL | Match Score | Verdict | Notes |
|------|-----|-------------|---------|-------|
| homepage | / | [score] | pass/fail | |
| sample-doc | /docs/projects/sample/design/ | [score] | pass/fail | |
| ... | ... | ... | ... | |

## Findings (if any)
### [Finding — severity: high/medium/low]
- **What:** [description]
- **Where:** [page/URL]
- **Evidence:** [screenshot path, diff score]
- **Baseline spec:** [which baseline drifted]

## Masks Applied
- Relative timestamps: replaced time-ago text in review panel comment elements

## Coverage
- **Baselines checked:** [N of 9]
- **Baselines skipped:** [any unreachable and why]
```

## Posting Evidence to the PR

### On PASS

```
## Regression QA — PASS
- **Baselines checked:** 9/9
- **All match within tolerance**
- **No unexpected drift detected**
```

### On ISSUES_FOUND or NEEDS_HUMAN

Report to orchestrator only — no PR comment.
