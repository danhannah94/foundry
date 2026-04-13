# Feature QA Prompt Template

Use this template to instruct a QA agent to verify a specific feature change. The orchestrator fills in the bracketed sections based on what the implementation agent changed.

---

## QA Objective

Verify that **[feature description]** was implemented correctly and is visually rendering as expected.

## What Changed

[Orchestrator fills this from the implementation agent's output — files changed, components affected, summary of the change.]

## Where to Look

- **Primary pages:** [URLs where the feature change is visible]
- **Entry point:** [How to navigate to the feature — e.g. "Go to /docs/projects/sample/design/ and open the review panel"]
- **Related pages:** [Pages that might be affected by the change]

## Success Criteria

- [ ] [Specific visual/functional check — e.g. "New annotation appears in the review panel with correct author and timestamp"]
- [ ] [Specific visual/functional check — e.g. "Reply thread renders with proper indentation"]
- [ ] [Specific visual/functional check — e.g. "Markdown formatting in annotation body renders correctly (bold, code, links)"]

## Also Check

- Regression in [related areas — e.g. "other annotations on the same page still render correctly"]
- [Known fragile areas — e.g. "navigation sidebar should not collapse unexpectedly"]

## Available Tools

**App MCP tools (use these for interaction):**
- [List domain-specific tools — e.g. `mcp__foundry__create_annotation`, `mcp__foundry__edit_annotation`, `mcp__foundry__get_page`]

**Crucible tools (use these for visual verification):**
- `navigate` — go to a URL
- `screenshot_page` — capture a screenshot (saves to file, returns path)
- `compare_screenshots` — diff against a stored baseline
- `list_baselines` — discover existing baselines for this project
- `run_script` — run JavaScript in the page context (set auth tokens, inject CSS, read DOM state)
- `click` — click an element by CSS selector (expand collapsed sections, toggle UI state)

**Note:** You do NOT have `approve_baseline`. Baseline approval is the orchestrator's responsibility. If your findings warrant a baseline update, recommend it in your report and the orchestrator will approve after review.

**Existing baselines:**
- [List from `list_baselines(project: "...")` — e.g. "foundry/homepage (1280x800)", "foundry/sample-doc-full (1280x1601)"]

## How to Work

1. Navigate to each page listed in "Where to Look"
2. Use the app's MCP tools to interact with the feature (create content, trigger actions, etc.)
3. Screenshot the result and visually inspect it — does it look correct?
4. If a baseline exists for this page, compare against it
5. If the feature introduces a new visual state, recommend a baseline update in your report (the orchestrator will approve it)
6. Use your judgment — you are not following a script. If something looks off, investigate.
7. Report findings using the QA Report format below

## QA Report Format

Return your findings in this format:

```
## Verdict: PASS | ISSUES_FOUND | NEEDS_HUMAN

## Findings
### [Finding — severity: high/medium/low]
- **What:** [description]
- **Where:** [page/URL]
- **Evidence:** [screenshot path, baseline path, diff score]
- **Suggested fix:** [if you have an opinion]

## Baselines
- **Updated:** [baselines you intentionally updated]
- **New:** [new baselines you proposed]
- **Failed:** [baselines that drifted unexpectedly]

## Coverage
- **Pages visited:** [URLs]
- **Tools used:** [app tools + Crucible tools invoked]
- **Areas not checked:** [anything you couldn't reach]
```
