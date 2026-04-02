---
name: foundry
description: Interact with Foundry documentation platform via MCP tools through mcporter. Search docs, manage annotations (create/edit/delete/reopen), manage reviews, list pages. Use when: (1) checking for new annotations or reviews on Foundry docs, (2) replying to human comments, (3) searching documentation content, (4) creating/editing/deleting annotations, (5) inspecting reviews, (6) listing available pages. NOT for: editing doc source markdown (use git), deploying Foundry (use deploy.sh or CI/CD).
---

# Foundry — MCP Tool Surface

Agents interact with Foundry exclusively through MCP tools via `mcporter`. The HTTP API exists for browser/frontend use — agents never call it directly.

## Available Tools

### Annotation Tools

| Tool | Purpose |
|------|---------|
| `foundry.list_annotations` | List annotations filtered by doc_path, section, status, review_id |
| `foundry.get_annotation` | Get single annotation by ID with its reply thread |
| `foundry.create_annotation` | Create annotation or threaded reply |
| `foundry.edit_annotation` | Edit annotation content |
| `foundry.delete_annotation` | Delete annotation (cascade-deletes replies) |
| `foundry.resolve_annotation` | Mark annotation as resolved |
| `foundry.reopen_annotation` | Reopen a resolved annotation |

### Review Tools

| Tool | Purpose |
|------|---------|
| `foundry.list_reviews` | List reviews for a document, optionally filtered by status |
| `foundry.get_review` | Get review by ID with all associated annotations |
| `foundry.submit_review` | Create review and batch-submit annotations |

### Navigation & Search

| Tool | Purpose |
|------|---------|
| `foundry.list_pages` | List all pages in the nav tree with access levels |
| `foundry.search_docs` | Semantic search across documentation |

## Tool Usage

### List Annotations
```bash
mcporter call foundry.list_annotations doc_path="/foundry/docs/projects/foundry/design/" status="submitted"
mcporter call foundry.list_annotations doc_path="/foundry/docs/methodology/process/" review_id="abc123"
```
- `doc_path` (required): URL path of the doc page
- `section` (optional): heading path filter
- `status` (optional): draft | submitted | replied | resolved | orphaned
- `review_id` (optional): filter to specific review

### Get Single Annotation
```bash
mcporter call foundry.get_annotation annotation_id="abc123"
```
Returns `{ annotation, replies[] }` — replies sorted chronologically.

### Create Annotation
```bash
# Top-level comment
mcporter call foundry.create_annotation doc_path="/foundry/docs/..." section="## Architecture" content="This section needs clarification."

# Reply to existing annotation
mcporter call foundry.create_annotation doc_path="/foundry/docs/..." section="## Architecture" content="Good point, I'll update this." parent_id="annotation-id"
```
- `doc_path` (required), `section` (required), `content` (required)
- `parent_id` (optional): set to reply to an existing annotation
- `author_type` (optional): defaults to "ai" for MCP callers

### Edit Annotation
```bash
mcporter call foundry.edit_annotation annotation_id="abc123" content="Updated content here"
```

### Delete Annotation
```bash
mcporter call foundry.delete_annotation annotation_id="abc123"
```
⚠️ Cascade-deletes all child replies. If it's the last annotation in a review, the review is also cleaned up.

### Resolve / Reopen
```bash
mcporter call foundry.resolve_annotation annotation_id="abc123"
mcporter call foundry.reopen_annotation annotation_id="abc123"
```

### List Reviews
```bash
mcporter call foundry.list_reviews doc_path="/foundry/docs/..." status="submitted"
```

### Get Review
```bash
mcporter call foundry.get_review review_id="abc123"
```
Returns `{ review, annotations[] }`.

### Submit Review
```bash
# Submit all draft/submitted annotations for a doc
mcporter call foundry.submit_review doc_path="/foundry/docs/..."

# Submit specific annotations
mcporter call foundry.submit_review doc_path="/foundry/docs/..." annotation_ids='["id1", "id2"]'
```

### List Pages
```bash
# Public pages only (default)
mcporter call foundry.list_pages

# Include private pages (requires auth)
mcporter call foundry.list_pages include_private=true
```
Returns `[{ title, path, access }]` for all pages in the nav tree.

### Search Docs
```bash
mcporter call foundry.search_docs query="annotation lifecycle" top_k=5
```

## Workflow Recipes

### Reply to Human Comments
```bash
# 1. Find unresolved human comments
mcporter call foundry.list_annotations doc_path="/foundry/docs/..." status="submitted"

# 2. Filter for author_type="human" with no AI reply (check replies via get_annotation)
mcporter call foundry.get_annotation annotation_id="<human-comment-id>"

# 3. Reply
mcporter call foundry.create_annotation doc_path="..." section="..." content="Response here" parent_id="<human-comment-id>"
```

### Full Review Cycle
```bash
# 1. Submit a review
mcporter call foundry.submit_review doc_path="/foundry/docs/..."

# 2. Verify
mcporter call foundry.list_reviews doc_path="/foundry/docs/..."

# 3. Inspect
mcporter call foundry.get_review review_id="<id>"

# 4. Reply to comments
mcporter call foundry.create_annotation ... parent_id="<id>"

# 5. Resolve threads
mcporter call foundry.resolve_annotation annotation_id="<id>"
```

### Clean Up Test Data
```bash
mcporter call foundry.list_annotations doc_path="..." status="draft"
mcporter call foundry.delete_annotation annotation_id="<id>"
```

### Cross-Tool: Content + Review
For document content, use Anvil. For annotations/reviews, use Foundry:
```bash
# Get doc content (Anvil)
mcporter call anvil.get_page path="projects/foundry/design"

# Get annotations on that doc (Foundry)
mcporter call foundry.list_annotations doc_path="/foundry/docs/projects/foundry/design/"
```

## Doc Path Format

Pages use the Astro base path with trailing slash:
- `/foundry/` — home
- `/foundry/docs/methodology/process/` — CSDLC process
- `/foundry/docs/projects/foundry/design/` — Foundry design doc

## Heading Path Format

Annotations reference sections as heading hierarchy:
```
## Architecture > ### Tech Stack
```
Match using text portion only (trailing `#` may appear from rehype-autolink-headings).
