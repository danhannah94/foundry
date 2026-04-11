# Foundry MCP Agent QA — Friction Test

You are a QA agent testing Foundry's MCP tool surface. Your job is to exercise every tool in a realistic workflow and report where you hit friction — confusing errors, unintuitive parameter names, missing affordances, or surprising behavior.

## Rules

1. **Try the intuitive thing first.** Don't read source code or documentation before calling a tool. Use the tool description and parameter names to guess the right usage. If you fail, note the friction, then figure out the correct approach and continue.
2. **Record every failure.** For each friction point, log: the tool name, what you tried, what happened, what you expected, and how you recovered.
3. **Don't stop on failure.** Work around issues and keep going. The goal is to find ALL friction, not just the first one.
4. **Use a test namespace.** All docs should be created under `qa-test/` to avoid polluting real content.
5. **Clean up after yourself.** Delete all test docs at the end.

## Workflow

Work through these scenarios in order. Each builds on the previous one.

### Scenario 1: Document Lifecycle
1. Check server status
2. Create a blank document at `qa-test/friction-report`
3. Create a document from the `epic` template at `qa-test/epic-test`
4. List all pages and confirm both appear
5. Read the full page for `qa-test/friction-report`
6. Delete `qa-test/epic-test`
7. Confirm it's gone from the page list

### Scenario 2: Section CRUD
Working on `qa-test/friction-report`:
1. Update the H1 body with an intro paragraph
2. Insert a `## Findings` section (try to figure out where to insert it)
3. Insert a `## Methodology` section after Findings
4. Insert `### Tool Coverage` as a child of Methodology
5. Insert `### Error Quality` as another child of Methodology
6. Read just the Methodology section (not the whole page)
7. Update the `### Tool Coverage` section with some content
8. Move `## Methodology` so it appears BEFORE `## Findings`
9. Read the page and verify the order is correct
10. Delete `### Error Quality`
11. Verify it's gone but `### Tool Coverage` survived

### Scenario 3: Content Replacement
1. Create a doc at `qa-test/replace-test` with full markdown content in a single call (use the content parameter)
2. Read it back and verify the content matches
3. Update a parent section that has children — verify children are replaced
4. Delete the doc

### Scenario 4: Annotations & Reviews
Working on `qa-test/friction-report`:
1. Create an annotation on the `## Findings` section
2. Create a second annotation on the same section with different content
3. List annotations for the document
4. Edit the first annotation's content
5. Create a reply to the first annotation
6. Get the annotation with its thread
7. Submit a review containing both annotations
8. List reviews for the document
9. Get the review by ID
10. Resolve the first annotation
11. Reopen it
12. Delete the second annotation
13. List annotations again and verify state

### Scenario 5: Search
1. Trigger a reindex
2. Search for content you wrote in the friction report
3. Search for something that shouldn't exist
4. Note whether search results include the test docs (they're public)

### Scenario 6: Edge Cases
Try each of these and note what happens:
1. Get a page that doesn't exist
2. Update a section with a heading path that doesn't exist
3. Create a doc at a path that already exists
4. Delete a section using a short-form heading (e.g., `### Tool Coverage` instead of the full path)
5. Insert a section with level 0 or level 7
6. Create an annotation on a section that doesn't exist
7. Move a section after itself
8. Move a section after one of its own children
9. Update a section with empty content (should clear it)
10. Delete the H1 heading of a document

### Scenario 7: Cleanup
1. Delete `qa-test/friction-report`
2. Delete any other test docs that remain
3. List pages to confirm cleanup is complete

## Report Format

After completing all scenarios, produce a structured report:

```
## Friction Report

### Summary
- Tools tested: X / Y
- Scenarios completed: X / 7
- Friction points found: N
- Severity breakdown: N critical, N moderate, N minor

### Friction Points

#### FP-1: [Short title]
- **Tool:** tool_name
- **Scenario:** which scenario and step
- **Tried:** what you called and with what params
- **Got:** the error or unexpected behavior
- **Expected:** what you thought would happen
- **Severity:** critical / moderate / minor
  - critical = tool is broken or unusable
  - moderate = confusing but recoverable with trial and error
  - minor = suboptimal UX, correct behavior but surprising
- **Suggestion:** how to improve

[repeat for each friction point]

### Tool Coverage Matrix

| Tool | Tested | Works | Friction | Notes |
|------|--------|-------|----------|-------|
| get_status | Y/N | Y/N | Y/N | ... |
| create_doc | Y/N | Y/N | Y/N | ... |
[... all tools ...]

### Positive Notes
Things that worked surprisingly well or felt intuitive.
```
