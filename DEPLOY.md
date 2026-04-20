# Foundry — Deployment Guide

## Architecture

Foundry runs as a single Docker container serving the static site + API + OAuth AS + MCP server on one port.

```
┌─────────────────────────────────────┐
│  Foundry Container (:3001)          │
│  ├── /*              → static site  │
│  ├── /api/*          → REST API     │
│  ├── /oauth/*        → OAuth AS+DCR │
│  ├── /.well-known/*  → AS metadata  │
│  └── /mcp            → MCP (HTTP)   │
│  SQLite → /data/foundry.db          │
└─────────────────────────────────────┘
```

## Authentication

Foundry has two auth paths:

1. **OAuth 2.0** — the primary path. Used by MCP clients (Claude Code,
   Claude.ai, Cowork) and by first-party site sessions. Clients register via
   DCR (RFC 7591), authorize against GitHub for identity, then call `/mcp`
   with the resulting Bearer access token.
2. **Legacy static token** (`FOUNDRY_WRITE_TOKEN`) — 30-day break-glass path
   for the REST annotation/review endpoints. Not used by MCP. Will be
   retired after operators have migrated.

### Security Model

| Endpoint | Auth Required | Rationale |
|----------|--------------|-----------|
| Static site (HTML/CSS/JS) | 🟨 | Access-controlled — public docs for all, private docs require auth |
| GET /api/docs/* | 🟨 | Access-controlled — filtered by access level |
| GET /api/search | 🟨 | Access-controlled — private results excluded without token |
| GET /api/health | ❌ | Monitoring |
| GET/POST/PATCH/DELETE /api/annotations* | ✅ | Review content is sensitive |
| GET/POST/PATCH /api/reviews* | ✅ | Review metadata is sensitive |
| POST /mcp | ✅ (OAuth) | MCP Streamable HTTP — always requires a Bearer token |
| GET /.well-known/oauth-* | ❌ | Discovery — must be public per RFC 8414 / 9728 |
| GET /oauth/authorize | ❌ | OAuth user-facing entry |
| POST /oauth/token | Client auth | Standard OAuth token endpoint |
| POST /oauth/register | DCR token | Dynamic Client Registration, gated by `FOUNDRY_DCR_TOKEN` |

### Legacy Token Setup (REST writes only)

`FOUNDRY_WRITE_TOKEN` is the break-glass bearer for the REST annotation and
review endpoints. MCP does **not** consult it — MCP always requires an
OAuth access token. This token is kept for 30 days past the HTTP-MCP
cutover to give operators room to migrate legacy scripts. See
[docs/mcp-migration.md](mcp-migration.md) for the MCP path.

1. **Generate a token:**
   ```bash
   openssl rand -hex 32
   ```

2. **Local development** — Create `.env` from `.env.example`:
   ```bash
   cp .env.example .env
   # Edit .env and set FOUNDRY_WRITE_TOKEN=<your-token>
   ```
   Without the token, REST annotation/review writes fall open (dev mode).
   MCP still requires OAuth regardless.

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

MCP clients authenticate with an OAuth 2.0 Bearer token. Supported clients
(Claude Code 2.1.64+, Claude.ai Connectors, Cowork-Claude) perform DCR +
PKCE automatically — the operator only needs to paste the `/mcp` URL and
complete the in-browser GitHub consent step.

Operators configuring a new client: see
[docs/mcp-migration.md](docs/mcp-migration.md) for the runbook.

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
7. **MCP tools:** Identity is threaded from the OAuth Bearer token on `POST /mcp` directly into service calls — private results are returned when the caller's scopes include `docs:read:private`

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

5. **Set secrets:**
   ```bash
   # OAuth AS — required for MCP
   fly secrets set FOUNDRY_OAUTH_ISSUER=https://foundry-claymore.fly.dev
   fly secrets set FOUNDRY_OAUTH_SESSION_SECRET=$(openssl rand -hex 32)
   fly secrets set FOUNDRY_DCR_TOKEN=$(openssl rand -hex 32)

   # GitHub identity provider for OAuth consent
   fly secrets set GITHUB_OAUTH_CLIENT_ID=<your-github-oauth-app-client-id>
   fly secrets set GITHUB_OAUTH_CLIENT_SECRET=<your-github-oauth-app-secret>

   # Comma-separated GitHub logins granted the docs:read:private scope.
   # Any user outside this list gets docs:read + docs:write only.
   fly secrets set FOUNDRY_PRIVATE_DOC_USERS=danhannah94,other-admin

   # Legacy break-glass token for REST writes (annotations/reviews)
   fly secrets set FOUNDRY_WRITE_TOKEN=$(openssl rand -hex 32)

   # Only if pulling private source repos
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

### Pre-deploy OAuth conformance check

Before any deploy that touches the OAuth surface, run the conformance
probe against staging (or prod if there is no staging environment):

```bash
FOUNDRY_BASE_URL=https://foundry-claymore.fly.dev \
FOUNDRY_DCR_TOKEN=<value> \
node scripts/oauth-conformance.mjs
```

All checks must pass (exit code 0) before merging the deploy. The
probe validates AS metadata shape (RFC 8414), DCR bearer gate (RFC 7591),
PKCE enforcement (RFC 7636), token endpoint error contract (RFC 6749),
and `WWW-Authenticate` shape (RFC 6750) against the live instance.

For threat-model coverage and accepted risks, see
[docs/security-review.md](docs/security-review.md).

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
| `FOUNDRY_OAUTH_ISSUER` | (none) | Required in prod. Public origin advertised as the OAuth issuer (e.g. `https://foundry-claymore.fly.dev`). Sourced only from this env — never from the `Host` header |
| `FOUNDRY_OAUTH_SESSION_SECRET` | (none) | Required in prod. HMAC-SHA256 key used to sign the `foundry_oauth_session` and `foundry_oauth_pending` cookies. Rotating invalidates in-flight auth flows; users just retry |
| `FOUNDRY_DCR_TOKEN` | (none) | Required in prod. Bearer token that gates `POST /oauth/register` so only trusted clients can dynamically register. See [docs/dcr-rotation.md](docs/dcr-rotation.md) for rotation |
| `GITHUB_OAUTH_CLIENT_ID` | (none) | GitHub OAuth app client id — used as the identity provider during consent |
| `GITHUB_OAUTH_CLIENT_SECRET` | (none) | GitHub OAuth app client secret |
| `FOUNDRY_PRIVATE_DOC_USERS` | (empty) | Comma-separated GitHub logins that receive the `docs:read:private` scope at token mint. Users not in this list get `docs:read` + `docs:write` only |
| `FOUNDRY_WRITE_TOKEN` | (none) | Legacy break-glass bearer for REST annotation/review writes. MCP no longer consults this. If unset, REST writes fall open in dev mode |
| `GITHUB_TOKEN` | (none) | GitHub token for private source repos |
| `NODE_ENV` | `production` | Node environment |

## Notes

- **SQLite data** persists in the `/data` volume. Back up `foundry.db` to preserve annotations.
- **Anvil search** is disabled in Docker builds (published npm package issue). Annotations work fine without it.
- **GitHub Pages** still deploys the static-only version. The container is the full-featured version with annotations.
