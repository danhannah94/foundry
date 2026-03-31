# Foundry — Deployment Guide

## Architecture

Foundry runs as a single Docker container serving the static site + API + MCP server on one port.

```
┌─────────────────────────────┐
│  Foundry Container (:3001)  │
│  ├── /*       → static site │
│  ├── /api/*   → REST API    │
│  └── /mcp/*   → MCP server  │
│  SQLite → /data/foundry.db  │
└─────────────────────────────┘
```

## Authentication

Foundry uses bearer token authentication to protect write operations (annotations, reviews) and annotation read access. Static docs and search remain public.

### Security Model

| Endpoint | Auth Required | Rationale |
|----------|--------------|-----------|
| Static site (HTML/CSS/JS) | ❌ | Docs are public content |
| GET /api/docs/* | ❌ | Same as static site |
| GET /api/search | ❌ | Search over public content |
| GET /api/health | ❌ | Monitoring |
| GET/POST/PATCH/DELETE /api/annotations* | ✅ | Review content is sensitive |
| GET/POST/PATCH /api/reviews* | ✅ | Review metadata is sensitive |
| MCP doc tools (search_docs, etc.) | ❌ | Public content |
| MCP annotation tools | ✅ | Same as API annotations |

### Token Setup

1. **Generate a token:**
   ```bash
   openssl rand -hex 32
   ```

2. **Local development** — Create `.env` from `.env.example`:
   ```bash
   cp .env.example .env
   # Edit .env and set FOUNDRY_WRITE_TOKEN=<your-token>
   ```
   Without the token, auth is disabled (dev mode — all requests allowed).

3. **Fly.io production:**
   ```bash
   fly secrets set FOUNDRY_WRITE_TOKEN=<your-token>
   ```

4. **Docker:**
   Set in `.env` file or pass directly:
   ```bash
   docker compose up  # reads from .env
   # or
   FOUNDRY_WRITE_TOKEN=abc123 docker compose up
   ```

### Frontend Auth Flow

1. Visit site → docs render freely
2. Open annotations panel → prompted for token
3. Enter token → stored in browser localStorage
4. All annotation API calls include Bearer token header
5. On 401 → token cleared, re-prompted

### MCP Client Auth

MCP annotation tools accept an `auth_token` parameter. Configure in your MCP client:
- In-process (same container): uses `FOUNDRY_WRITE_TOKEN` env var directly
- Remote clients: pass token as tool parameter

## Fly.io (Production)

### One-Time Setup

1. **Install Fly CLI:**
   ```bash
   brew install flyctl
   # or: curl -L https://fly.io/install.sh | sh
   ```

2. **Login:**
   ```bash
   fly auth login
   ```

3. **Launch the app** (from repo root):
   ```bash
   fly launch --no-deploy
   # When prompted: use existing fly.toml, don't create database
   ```

4. **Create persistent volume:**
   ```bash
   fly volumes create foundry_data --region iad --size 1
   ```

5. **Set secrets** (if using private source repos):
   ```bash
   fly secrets set GITHUB_TOKEN=ghp_your_token_here
   ```

6. **Deploy:**
   ```bash
   fly deploy --remote-only
   ```

7. **Verify:**
   ```bash
   curl https://foundry-claymore.fly.dev/api/health
   ```

### Continuous Deployment

Push to `main` → GitHub Actions builds and deploys automatically via `.github/workflows/deploy-fly.yml`.

**Required GitHub repo secret:** `FLY_API_TOKEN` (from https://fly.io/user/personal_access_tokens)

### Useful Commands

```bash
fly status                  # App status
fly logs                    # Live logs
fly ssh console             # SSH into the container
fly volumes list            # Check persistent storage
fly scale count 1           # Ensure 1 machine running
fly deploy --remote-only    # Manual deploy
```

## Docker (Local / Work)

### Quick Start

```bash
docker compose up -d
# → http://localhost:3001
```

### With Private Source Repos

```bash
GITHUB_TOKEN=ghp_xxx docker compose up -d --build
```

### Manual Docker Run

```bash
docker build -t foundry .
docker run -p 3001:3001 -v foundry-data:/data foundry
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `FOUNDRY_DB_PATH` | `/data/foundry.db` | SQLite database path |
| `FOUNDRY_STATIC_PATH` | `../../site/dist` | Path to Astro build output |
| `FOUNDRY_WRITE_TOKEN` | (none) | Bearer token for API write protection; if unset, auth disabled (dev mode) |
| `GITHUB_TOKEN` | (none) | GitHub token for private source repos |
| `NODE_ENV` | `production` | Node environment |

## Notes

- **SQLite data** persists in the `/data` volume. Back up `foundry.db` to preserve annotations.
- **Anvil search** is disabled in Docker builds (published npm package issue). Annotations work fine without it.
- **GitHub Pages** still deploys the static-only version. The container is the full-featured version with annotations.
