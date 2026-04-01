# 🏭 Foundry

A documentation platform built for human-AI collaborative workflows. One source of truth, two audiences: humans get a rich interactive UI with inline comments, AI agents get MCP tools for search and annotation.

## Features

- **Multi-repo content sourcing** — pull markdown from any GitHub repo at build time
- **Public/private access control** — open methodology docs, gated project docs
- **Annotations + unified review thread** — highlight text, comment, threaded replies
- **Bearer token auth** — protects write operations and private content
- **Semantic search** — powered by [Anvil](https://github.com/claymore-dev/anvil) (local embeddings, no API keys)
- **MCP server** — AI agents can search, read, and annotate docs via Model Context Protocol
- **TTS playback** — read docs aloud via Web Speech API
- **Dark/light theme** — system-aware with manual toggle

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/danhannah94/foundry.git
cd foundry
npm install
```

### 2. Configure content sources

```bash
cp foundry.config.example.yaml foundry.config.yaml
```

Edit `foundry.config.yaml` to point at your doc repos:

```yaml
sources:
  - repo: your-org/docs-repo
    branch: main
    paths:
      - "docs/public/"
    access: public

  - repo: your-org/internal-docs
    branch: main
    paths:
      - "docs/projects/"
    access: private
```

For private repos, set `GITHUB_TOKEN`:
```bash
export GITHUB_TOKEN=$(gh auth token)
```

### 3. Configure navigation

Edit `nav.yaml` to define your sidebar structure. See the existing file for format.

### 4. Set up environment

```bash
cp .env.example .env
# Generate a write token for auth:
echo "FOUNDRY_WRITE_TOKEN=$(openssl rand -hex 32)" >> .env
```

### 5. Run locally

**Dev mode (hot reload):**
```bash
# Terminal 1: API server
cd packages/api && npm run dev

# Terminal 2: Site
cd packages/site && npm run dev
```
Site: `http://localhost:4321/foundry` | API: `http://localhost:3001`

**Docker:**
```bash
docker compose up --build -d
```
Everything on `http://localhost:3001/foundry/`

### 6. Deploy to Fly.io

```bash
fly launch
fly secrets set FOUNDRY_WRITE_TOKEN=$(openssl rand -hex 32)
fly deploy --remote-only --build-arg GITHUB_TOKEN=$(gh auth token)
```

## Project Structure

```
foundry/
├── packages/
│   ├── site/               # Astro static site (React islands)
│   │   ├── src/
│   │   │   ├── layouts/    # Page layouts
│   │   │   ├── pages/      # Route pages
│   │   │   ├── components/ # UI components (auth, comments, TTS)
│   │   │   └── styles/     # Global CSS
│   │   └── content/        # Markdown docs (populated at build time)
│   └── api/                # Express API server
│       └── src/
│           ├── routes/     # REST endpoints
│           ├── middleware/  # Auth middleware
│           └── mcp/        # MCP server + tools
├── foundry.config.yaml     # Content source repos (your config)
├── nav.yaml                # Sidebar navigation tree
├── scripts/
│   └── build.sh            # Multi-repo content fetcher
├── Dockerfile              # Multi-stage production build
├── docker-compose.yml      # Local Docker setup
└── fly.toml                # Fly.io deployment config
```

## How It Works

1. **Build time:** `scripts/build.sh` reads `foundry.config.yaml`, clones repos, copies specified paths into `packages/site/content/`, and generates `.access.json` for access control
2. **Astro** builds the markdown into static HTML pages
3. **Express** serves the static site + REST API + MCP endpoints
4. **Anvil** indexes the markdown for semantic search (local embeddings via ONNX)
5. **Auth** gates private docs in the nav sidebar and protects write endpoints

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/health` | No | Server status + Anvil stats |
| `GET /api/access` | No | Access level map |
| `GET /api/search?q=...` | Optional | Semantic search (private results need token) |
| `GET /api/annotations?doc_path=...` | Yes | List annotations for a doc |
| `POST /api/annotations` | Yes | Create annotation |
| `PATCH /api/annotations/:id` | Yes | Update annotation status/content |
| `POST /api/reviews` | Yes | Create review |
| `PATCH /api/reviews/:id` | Yes | Update review status |

Auth: `Authorization: Bearer <FOUNDRY_WRITE_TOKEN>`

## Tech Stack

| Layer | Choice |
|-------|--------|
| Site | Astro 6 + React 19 islands |
| API | Express + TypeScript |
| Search | Anvil (sqlite-vss + ONNX embeddings) |
| AI Integration | Model Context Protocol (MCP) |
| Database | SQLite (better-sqlite3) |
| Deploy | Docker + Fly.io |

## License

MIT
