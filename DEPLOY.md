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
| Static site (HTML/CSS/JS) | 🟨 | Access-controlled — public docs for all, private docs require auth |
| GET /api/docs/* | 🟨 | Access-controlled — filtered by access level |
| GET /api/search | 🟨 | Access-controlled — private results excluded without token |
| GET /api/health | ❌ | Monitoring |
| GET/POST/PATCH/DELETE /api/annotations* | ✅ | Review content is sensitive |
| GET/POST/PATCH /api/reviews* | ✅ | Review metadata is sensitive |
| MCP doc tools (search_docs, etc.) | 🟨 | Access-controlled — accepts optional auth_token |
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

## Public/Private Doc Access Control

Foundry supports source-level access control: some docs are public (anyone can read), others are private (requires authentication).

### Configuration

Access levels are set in `foundry.config.yaml` per source path:

```yaml
sources:
  - repo: danhannah94/csdlc-docs
    branch: main
    paths:
      - "docs/methodology/"
    access: public

  - repo: danhannah94/csdlc-docs
    branch: main
    paths:
      - "docs/projects/"
    access: private
```

The build script generates `.access.json` mapping path prefixes to access levels. The server uses this at runtime.

### What Users See

| User State | Docs | Nav | Search | API |
|-----------|------|-----|--------|-----|
| Unauthenticated | Public docs only | Public sections only | Public results only | Public endpoints only |
| Authenticated | All docs | Full nav | All results | All endpoints |

### How It Works

1. **Build time:** All docs (public + private) are built into the container
2. **Runtime:** Server checks each request against `.access.json`
3. **Static files:** Private doc HTML returns 401 without valid token
4. **API endpoints:** `/api/docs/*` checks access level before serving
5. **Search:** Results filtered server-side — private content never reaches unauthenticated clients
6. **Nav sidebar:** Client-side filtering hides private sections when no token present
7. **MCP tools:** `search_docs` accepts optional `auth_token` for private results

### Adding New Content

To add a new source with access control:
1. Add entry to `foundry.config.yaml` with `access: public` or `access: private`
2. Rebuild the container — `.access.json` is regenerated automatically
3. No code changes needed

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
