---
name: foundry
description: Interact with the Foundry documentation platform via MCP tools. Search docs, read pages/sections, manage annotations and reviews, create and edit documents, sync to GitHub. Use when working with design docs, running refinement sessions, reviewing documents, or managing doc content. NOT for editing Foundry source code or deploying Foundry infrastructure.
---

# Foundry — MCP Tool Reference

Foundry is accessed exclusively through MCP tools prefixed with `mcp__foundry__`. All tools communicate with the Foundry API server.

## Tool Inventory

### Reading & Search

| Tool | Purpose |
|------|---------|
| `mcp__foundry__list_pages` | List all pages in the nav tree with access levels |
| `mcp__foundry__get_page` | Get a document with its full section structure |
| `mcp__foundry__get_section` | Get a specific section by doc path + heading path |
| `mcp__foundry__search_docs` | Semantic search across all documentation |
| `mcp__foundry__get_status` | Health check — server status + Anvil index stats |

### Document CRUD

| Tool | Purpose |
|------|---------|
| `mcp__foundry__create_doc` | Create a new document from a template (epic, subsystem, project, workflow, blank) |
| `mcp__foundry__update_section` | Update a section's body content by heading path |
| `mcp__foundry__insert_section` | Insert a new section after an existing heading |
| `mcp__foundry__delete_section` | Delete a section by heading path |

### Annotations

| Tool | Purpose |
|------|---------|
| `mcp__foundry__list_annotations` | List annotations filtered by doc_path, section, status, review_id |
| `mcp__foundry__get_annotation` | Get single annotation by ID with reply thread |
| `mcp__foundry__create_annotation` | Create annotation or threaded reply |
| `mcp__foundry__edit_annotation` | Edit annotation content |
| `mcp__foundry__delete_annotation` | Delete annotation (cascade-deletes replies) |
| `mcp__foundry__resolve_annotation` | Mark annotation as resolved |
| `mcp__foundry__reopen_annotation` | Reopen a resolved annotation |

### Reviews

| Tool | Purpose |
|------|---------|
| `mcp__foundry__list_reviews` | List reviews for a document, optionally filtered by status |
| `mcp__foundry__get_review` | Get review by ID with all associated annotations |
| `mcp__foundry__submit_review` | Create review and batch-submit annotations |

### Import & Sync

| Tool | Purpose |
|------|---------|
| `mcp__foundry__import_repo` | Import docs from a GitHub repo into Foundry |
| `mcp__foundry__sync_to_github` | Push Foundry content to GitHub as backup |
| `mcp__foundry__reindex` | Trigger full Anvil reindex (after content changes outside CRUD tools) |

## Doc Path Format

Documents use **relative file paths** from the content root, with `.md` extension:

```
Race Strategy/epics/epic-deployment-infrastructure.md
Race Strategy/sub-systems/deployment-access-control.md
Data Engineering/Design Docs/bronze-pipeline-design-doc.md
Signal Mapping/vCar.md
```

For `create_doc`, omit the `.md` extension:
```
Race Strategy/epics/epic-new-feature
```

## Heading Path Format

Sections are addressed by **Anvil-style heading paths** — the heading text with `#` prefix, using ` > ` to separate hierarchy:

```
## Architecture
## Architecture > ### Tech Stack
# Epic Title > ## 5. Stories > ### D-1: Terraform Foundation
```

**Known issue:** The section parser does not skip fenced code blocks, so bash comments (`# comment`) inside code blocks are parsed as headings. This can produce unexpected heading paths. When `update_section` returns "Section not found", parse the actual sections to find the correct path:

```python
# Use get_page to inspect section structure first
mcp__foundry__get_page(path="Race Strategy/epics/my-doc.md")
```

## Workflow Recipes

### Design Doc Review (Refinement)

The core CSDLC workflow — AI reviews a design doc, creates annotations for open questions, human responds, AI processes answers and updates the doc.

```
1. Read the doc
   mcp__foundry__get_page(path="Race Strategy/epics/my-epic.md")

2. Create annotations for each open question or concern
   mcp__foundry__create_annotation(
     doc_path="Race Strategy/epics/my-epic.md",
     section="## 5. Stories > ### D-4: Cognito Auth",
     content="Question about X...",
     author_type="ai"
   )

3. Submit as a review batch
   mcp__foundry__submit_review(
     doc_path="Race Strategy/epics/my-epic.md",
     annotation_ids=["id1", "id2", "id3"]
   )

4. Check for human replies
   mcp__foundry__list_annotations(
     doc_path="Race Strategy/epics/my-epic.md",
     status="submitted"
   )

5. Reply to human comments
   mcp__foundry__create_annotation(
     doc_path="...", section="...",
     content="Response here",
     parent_id="<human-annotation-id>"
   )

6. Resolve closed threads
   mcp__foundry__resolve_annotation(annotation_id="<id>")

7. Update the doc with locked-in decisions
   mcp__foundry__update_section(
     path="Race Strategy/epics/my-epic.md",
     heading="<heading-path>",
     content="Updated section content..."
   )
```

### Create a New Design Doc

```
1. Create from template
   mcp__foundry__create_doc(
     path="Race Strategy/epics/epic-new-feature",
     template="epic",
     title="Epic: New Feature"
   )

2. Populate sections
   mcp__foundry__update_section(
     path="Race Strategy/epics/epic-new-feature.md",
     heading="## 1. Overview",
     content="Section content here..."
   )

3. Add custom sections
   mcp__foundry__insert_section(
     path="Race Strategy/epics/epic-new-feature.md",
     after_heading="## 1. Overview",
     heading="Custom Section",
     level=2,
     content="New section content..."
   )
```

### Search and Cross-Reference

```
1. Semantic search
   mcp__foundry__search_docs(query="authentication cognito", top_k=5)

2. Read a specific section from search results
   mcp__foundry__get_section(
     path="Race Strategy/sub-systems/deployment-access-control.md",
     heading_path="## 6. Auth Architecture"
   )
```

### Sync Content to GitHub

```
mcp__foundry__sync_to_github(branch="main")
```

Force-pushes Foundry content to the configured GitHub remote. Foundry is the source of truth.

## Templates

Available templates for `create_doc`:

| Template | Use Case |
|----------|----------|
| `epic` | Epic-level design doc (scope, stories, acceptance criteria, risks) |
| `subsystem` | Sub-system architecture doc (boundaries, interfaces, data model) |
| `project` | Project-level design doc (architecture, tech stack, deployment) |
| `workflow` | Process/workflow documentation |
| `blank` | Empty doc with just a title heading |

## Auth

Write operations (create, update, delete, annotations, reviews, sync) require the `FOUNDRY_WRITE_TOKEN` configured in the MCP server connection. Read operations are unauthenticated for public docs. Private docs require an `auth_token` parameter on `search_docs`.
