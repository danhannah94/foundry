# Regression QA Prompt Template

Use this template to instruct a regression QA agent to sweep all existing baselines for visual drift. This agent runs in parallel with the feature QA agent.

---

## Regression Objective

Check all stored baselines for **[project name]** to verify no visual regressions were introduced. This runs after a feature change was implemented — your job is to catch unintended side effects.

## How to Discover the Test Suite

Run `list_baselines(project: "[project]")` to get all stored baselines. Each baseline has:
- A **spec name** (e.g. "homepage", "sample-doc-full")
- **Metadata** including the URL, viewport size, and when it was captured

The baseline store IS the regression suite — you don't maintain a manual list.

## How to Work

For each baseline returned by `list_baselines`:

1. **Navigate** to the baseline's URL
2. **Screenshot** the page with the same settings (fullPage true/false, matching viewport)
3. **Compare** against the stored baseline using `compare_screenshots`
4. If the diff **passes** (matchScore within tolerance): move on
5. If the diff **fails**: visually inspect the screenshot. Is the change intentional (related to the feature being implemented) or unexpected?
   - **Intentional change:** note it as a proposed baseline update in your report
   - **Unexpected change:** report it as a regression finding with evidence

## Available Tools

**Crucible tools:**
- `navigate` — go to a URL
- `screenshot_page` — capture a screenshot (saves to file, returns path)
- `compare_screenshots` — diff against a stored baseline
- `list_baselines` — discover all baselines for this project
- `run_script` — run JavaScript in the page context (set auth tokens, read DOM state)
- `click` — click an element by CSS selector (expand collapsed sections, toggle UI state)

**Note:** You do NOT have `approve_baseline`. If a baseline needs updating (intentional change), recommend it in your report. The orchestrator will approve after review.

**App MCP tools (if needed for page state):**
- [List any app tools needed to reach authenticated or interactive states]

## Known Fragile Areas

- [Manually curated warnings — e.g. "Review panel may show different annotation counts if test data changed"]
- [Areas prone to false positives — e.g. "Timestamps in footer update on each render"]

## Verdict Rules

- All baselines match within tolerance: **PASS**
- Any baseline drifted unexpectedly: **ISSUES_FOUND** (include evidence)
- Uncertain whether drift is intentional: **NEEDS_HUMAN**

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

## Baselines
- **Updated:** [baselines you propose updating — change was intentional]
- **Failed:** [baselines that drifted unexpectedly]

## Coverage
- **Baselines checked:** [N of M]
- **Baselines skipped:** [any you couldn't reach and why]
```
