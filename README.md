# 🏭 Foundry

A documentation platform built for human-AI collaborative workflows. One source of truth, two audiences: humans get a rich interactive UI with inline comments, AI agents get MCP tools for search and annotation.

## Features

- **Runtime content fetching** — clones docs from GitHub at startup, updates via webhook on push
- **SSR rendering** — Astro server-side rendering for dynamic markdown pages
- **Filesystem-based navigation** — sidebar auto-generated from content directory structure and frontmatter
- **Public/private access control** — open methodology docs, gated project docs
- **Annotations + unified review thread** — highlight text, comment, threaded replies
- **Bearer token auth** — protects write operations and private content
- **Semantic search** — powered by [Anvil](https://github.com/claymore-dev/anvil) (local embeddings, no API keys)
- **MCP server** — AI agents can search, read, and annotate docs via Model Context Protocol
- **TTS playback** — read docs aloud via Web Speech API
- **Dark/light theme** — system-aware with manual toggle

## Architecture

Foundry runs two processes behind a single port:

```
Port 4321 (proxy)
├── /api/*  → Express API (port 3001, internal)
├── /mcp/*  → Express API (MCP endpoints)
└── /*      → Astro SSR (dynamic page rendering)
```

On startup:
1. Express API starts on port 3001, clones the configured content repo via `ContentFetcher`
2. Anvil indexes the markdown for semantic search
3. Node proxy starts on port 4321, routing requests to API or Astro SSR
4. GitHub webhook triggers pull + reindex on push events — no rebuild needed

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/danhannah94/foundry.git
cd foundry
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Content source — your docs repo
CONTENT_REPO=https://github.com/your-org/your-docs.git
CONTENT_BRANCH=main

# For private repos, use SSH + deploy key:
# CONTENT_REPO=git@github.com:your-org/your-docs.git
# DEPLOY_KEY_B64=<base64-encoded private key>

# GitHub webhook secret (for auto-updates on push)
WEBHOOK_SECRET=<openssl rand -hex 32>

# API write protection (annotations/reviews)
FOUNDRY_WRITE_TOKEN=<openssl rand -hex 32>
```

**Private repo setup** — see [Deploy Key Setup](#deploy-key-setup-private-repos) below.

### 3. Configure content sources (optional)

Edit `foundry.config.yaml` to define access control per path:

```yaml
sources:
  - repo: your-org/docs-repo
    branch: main
    paths:
      - "docs/public/"
    access: public

  - repo: your-org/docs-repo
    branch: main
    paths:
      - "docs/projects/"
    access: private
```

### 4. Run with Docker (recommended)

```bash
docker compose up --build -d
```

Site available at `http://localhost:4321`

### 5. Run locally (dev mode)

```bash
# Terminal 1: API server (port 3001)
cd packages/api && npm run dev

# Terminal 2: Astro site (port 4321, proxies /api to 3001)
cd packages/site && npm run dev
```

Site: `http://localhost:4321` | API: `http://localhost:3001`

### 6. Deploy to Fly.io

```bash
fly launch
fly secrets set CONTENT_REPO=git@github.com:your-org/docs.git
fly secrets set CONTENT_BRANCH=main
fly secrets set DEPLOY_KEY_B64=$(cat ~/.ssh/foundry_deploy_key | base64 -w0)
fly secrets set WEBHOOK_SECRET=$(openssl rand -hex 32)
fly secrets set FOUNDRY_WRITE_TOKEN=$(openssl rand -hex 32)
fly deploy --remote-only
```

## Deploy Key Setup (Private Repos)

If your content repo is private, Foundry uses an SSH deploy key to clone it at runtime.

**1. Generate the key:**
```bash
ssh-keygen -t ed25519 -C "foundry-deploy-key" -f ~/.ssh/foundry_deploy_key -N ""
```

**2. Add the public key to your docs repo:**

Go to your docs repo → Settings → Deploy keys → Add deploy key:
- **Title:** `Foundry content fetcher`
- **Key:** contents of `~/.ssh/foundry_deploy_key.pub`
- **Allow write access:** unchecked (read-only)

**3. Base64-encode the private key:**
```bash
cat ~/.ssh/foundry_deploy_key | base64 -w0
```

**4. Add to `.env`:**
```env
CONTENT_REPO=git@github.com:your-org/your-docs.git
DEPLOY_KEY_B64=<paste base64 string>
```

## GitHub Webhook Setup (Auto-Updates)

When you push to the docs repo, Foundry can automatically pull changes and reindex.

Go to your docs repo → Settings → Webhooks → Add webhook:
- **Payload URL:** `https://<your-foundry-url>/api/webhooks/content-update`
- **Content type:** `application/json`
- **Secret:** same value as `WEBHOOK_SECRET` in your `.env`
- **Events:** Just the push event

## Content Structure

Foundry expects your docs repo to have a `docs/` directory at the root:

```
your-docs-repo/
├── docs/
│   ├── index.md              # Root page
│   ├── getting-started.md    # Top-level page
│   ├── guides/
│   │   ├── index.md          # Section landing page
│   │   └── first-guide.md
│   └── reference/
│       └── api.md
└── mkdocs.yml                # (ignored by Foundry)
```

**Navigation** is auto-generated from the filesystem. Control ordering and titles with frontmatter:

```yaml
---
title: My Page Title
nav_title: Short Nav Title   # Optional: shorter title for sidebar
order: 1                     # Optional: sort order (lower = higher)
---
```

Pages without `order` are sorted alphabetically after ordered pages.

## Project Structure

```
foundry/
├── packages/
│   ├── site/                 # Astro SSR site (React islands)
│   │   ├── src/
│   │   │   ├── layouts/      # Page layouts
│   │   │   ├── pages/        # Route pages (dynamic [...slug].astro)
│   │   │   ├── components/   # UI components (auth, comments, TTS)
│   │   │   ├── utils/        # Nav builder, page cache, markdown renderer
│   │   │   └── styles/       # Global CSS
│   │   └── content/          # Docs cloned here at runtime
│   └── api/                  # Express API server
│       └── src/
│           ├── routes/       # REST endpoints (docs, search, webhook, etc.)
│           ├── middleware/    # Auth middleware
│           ├── mcp/          # MCP server + tools
│           └── content-fetcher.ts  # Git clone/pull manager
├── scripts/
│   ├── start.sh              # Container entrypoint (API + proxy)
│   └── proxy.mjs             # Production proxy (port 4321)
├── foundry.config.yaml       # Content access control config
├── Dockerfile                # Multi-stage production build
├── docker-compose.yml        # Local Docker setup
└── fly.toml                  # Fly.io deployment config
```

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/content/status` | No | Content fetch status + current ref |
| `GET /api/health` | No | Server status + Anvil stats |
| `GET /api/access` | No | Access level map |
| `GET /api/search?q=...` | Optional | Semantic search (private results need token) |
| `POST /api/webhooks/content-update` | Webhook secret | GitHub push webhook |
| `GET /api/annotations?doc_path=...` | Yes | List annotations for a doc |
| `POST /api/annotations` | Yes | Create annotation |
| `PATCH /api/annotations/:id` | Yes | Update annotation status/content |
| `POST /api/reviews` | Yes | Create review |
| `PATCH /api/reviews/:id` | Yes | Update review status |

Auth: `Authorization: Bearer <FOUNDRY_WRITE_TOKEN>`

## Tech Stack

| Layer | Choice |
|-------|--------|
| Site | Astro 6 (SSR) + React 19 islands |
| API | Express + TypeScript |
| Search | Anvil (sqlite-vss + ONNX embeddings) |
| AI Integration | Model Context Protocol (MCP) |
| Database | SQLite (better-sqlite3) |
| Deploy | Docker + Fly.io |

## License

MIT
