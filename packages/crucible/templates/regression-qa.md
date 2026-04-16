# Regression QA Prompt Template

Use this template to instruct a regression QA agent to sweep all existing baselines for visual drift. This agent runs **after** the feature QA agent passes and baselines have been approved — by the time regression runs, all baselines are current. Any drift is a real regression.

---

## Regression Objective

Check all stored baselines for **[project name]** to verify no visual regressions were introduced. This runs after feature QA passed and baselines were approved — your job is to catch unintended side effects on pages the feature agent didn't check.

## Test Environment

**Always boot a fresh test-env for regression QA.** Do not reuse long-running instances — they may be running stale code. A fresh build from the target branch guarantees you're testing current code with clean seed data.

```bash
# Boot fresh test-env from the target branch
test-env/scripts/qa.sh [branch]     # e.g. "main" for regression, or a feature branch
# Output includes the port — use that URL for all baselines
```

After the regression sweep completes, tear down:
```bash
test-env/scripts/qa-cleanup.sh [branch]
```

If the orchestrator already booted a fresh test-env for feature QA (from the same branch), reuse that URL instead of booting a second instance.

## How to Discover the Test Suite

Run `list_baselines(project: "[project]")` to get all stored baselines. Each baseline has:
- A **spec name** (e.g. "homepage", "sample-doc-full")
- **Metadata** including the URL, viewport size, when it was captured, and a note describing the expected state

The baseline store IS the regression suite — you don't maintain a manual list. If `baselines` were passed as a parameter, only check those (the orchestrator is sharding across multiple agents).

## Baseline Setup Requirements

Each baseline may require specific setup before screenshotting. Read the baseline's `meta.note` for context. Common setup patterns:

| Setup Pattern | How to Apply |
|---------------|-------------|
| **Unauthenticated** | No setup needed — just navigate and screenshot |
| **Authenticated** | Open the token modal (click `.thread-auth-prompt button`), fill the input (`.token-modal__input`), and submit (`.token-modal__submit`) with 'test-token'. Note: `navigate` resets page context, so authenticate AFTER navigating. |
| **Modal open** | Navigate, authenticate if needed, then click the trigger element (e.g. `.settings-gear-btn` for settings, `.search-modal__icon-button` for search) |
| **Dark mode** | Authenticate, open settings (`.settings-gear-btn`), click the "Dark" radio label (`.settings-radio` with text "Dark"), close settings |
| **Expanded thread** | Authenticate, then click `.thread-replies-toggle` to expand the reply thread |
| **Draft visible** | Authenticate. A draft annotation must exist in the test-env's database — create one via the test-env API if needed: `POST /api/annotations` with `author_type: "human"` (defaults to draft status) |
| **fullPage screenshot** | If the baseline's height > viewport height (800px), use `screenshot_page(fullPage: true)` |

## Dynamic Content Masking

Before screenshotting any page with dynamic content, mask it to prevent false positives. Apply masks via `run_script` AFTER the page has loaded and any setup is complete, but BEFORE screenshotting.

**Required masks:**
```javascript
// Mask relative timestamps — these drift between sessions
document.querySelectorAll('[class*="time"], [class*="date"], [class*="ago"]')
  .forEach(el => { if (el.textContent.match(/ago|just now|yesterday/i)) el.textContent = 'X ago'; });
```

**Rules for masking:**
- Only mask dynamic TEXT content, never structural elements
- Never hide, remove, or resize elements — only replace text
- Document every mask applied in your report's "Masks Applied" section
- If unsure whether something is dynamic, DON'T mask it — let it fail and report it

## How to Work

For each baseline returned by `list_baselines`:

1. **Navigate** to the baseline's URL
2. **Set up** the required page state (auth, modals, theme — see Baseline Setup Requirements)
3. **Apply masks** for dynamic content
4. **Screenshot** the page with the correct settings (fullPage true/false, matching viewport)
5. **Compare** against the stored baseline using `compare_screenshots`
6. If the diff **passes** (matchScore within tolerance): move on
7. If the diff **fails**: visually inspect the screenshot. Since baselines were updated before this run, any drift is unexpected — report it as a regression finding.

**Important:** `navigate` resets the browser context (localStorage, cookies). If you need to check multiple baselines on the same URL with different states (e.g. authenticated vs. unauthenticated), group them: do all unauthenticated baselines first, then authenticate and do all authenticated ones. This avoids unnecessary re-authentication.

## Available Tools

**Crucible tools:**
- `navigate` — go to a URL (resets page context)
- `screenshot_page` — capture a screenshot (saves to file, returns path)
- `compare_screenshots` — diff against a stored baseline
- `list_baselines` — discover all baselines for this project
- `run_script` — run JavaScript in the page context (set auth tokens, mask timestamps, read DOM state)
- `click` — click an element by CSS selector (expand collapsed sections, toggle UI state, open modals)

**Note:** You do NOT have `approve_baseline`. Since baselines were already updated before this run, you should not need to propose updates. If you find drift, it's a regression — report it.

**App MCP tools (if needed for page state):**
- [List any app tools needed to reach authenticated or interactive states]

## Known Fragile Areas

- [Manually curated warnings — e.g. "Review panel may show different annotation counts if test data changed"]
- [Areas prone to false positives — e.g. "Timestamps in footer update on each render"]

## Verdict Rules

- All baselines match within tolerance: **PASS**
- Any baseline drifted unexpectedly: **ISSUES_FOUND** (include evidence)
- Uncertain whether drift is a real regression: **NEEDS_HUMAN**

## QA Report Format

Return your findings in this format:

```
## Verdict: PASS | ISSUES_FOUND | NEEDS_HUMAN

## Baseline Results
| Spec | URL | Match Score | Verdict | Notes |
|------|-----|-------------|---------|-------|
| [spec] | [url] | [score] | pass/fail | [any notes] |

## Findings
### [Finding — severity: high/medium/low]
- **What:** [description of the regression]
- **Where:** [page/URL]
- **Evidence:** [screenshot path, baseline path, diff score]
- **Baseline spec:** [which baseline drifted]

## Masks Applied
- [list each mask and what it targeted — e.g. "Relative timestamps: replaced 'X ago' text in .thread-comment elements"]

## Coverage
- **Baselines checked:** [N of M]
- **Baselines skipped:** [any you couldn't reach and why]
```

## Posting Evidence to the PR

### On PASS — post a lightweight summary to the PR

```
## Regression QA — PASS
- **Baselines checked:** [N/N]
- **All match within tolerance**
- **No unexpected drift detected**
```

### On ISSUES_FOUND or NEEDS_HUMAN — do NOT post to the PR

Report to orchestrator only. Same policy as feature QA — only PASS verdicts become durable PR artifacts.
