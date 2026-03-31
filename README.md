# 🏭 Foundry

Documentation platform for human-AI collaborative workflows. Built with Astro + Express + Anvil.

## Features
- Multi-repo content sourcing
- Dark/light theme
- TTS playback (Web Speech API)
- Annotations + unified review thread
- Bearer token authentication
- Public/private doc access control
- MCP server for AI agent integration
- Semantic search via Anvil

## Quick Start

See [DEPLOY.md](DEPLOY.md) for setup instructions.

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
foundry/
├── packages/
│   ├── site/               # Astro static site
│   │   ├── src/
│   │   │   ├── layouts/    # Page layouts
│   │   │   ├── pages/      # Route pages
│   │   │   ├── components/ # UI components
│   │   │   └── styles/     # Global CSS
│   │   ├── content/        # Markdown docs (populated by build script)
│   │   └── public/         # Static assets
│   └── api/                # API server (v0.2+)
├── foundry.config.yaml     # Content source repos
├── nav.yaml                # Navigation tree
├── scripts/
│   └── build.sh            # Multi-repo content fetch
└── package.json            # Monorepo root
```

## Deployment

**Live site:** https://danhannah94.github.io/foundry/

The site auto-deploys to GitHub Pages on every push to `main` via GitHub Actions.

- **Automatic:** Push to `main` triggers a build and deploy
- **Manual:** Go to Actions tab → "Deploy to GitHub Pages" → "Run workflow"
- **Config:** `.github/workflows/deploy.yml`

## Architecture

- **v0.1** — Static site on GitHub Pages
- **v0.2** — API server with Anvil search, TTS, annotations
- **v0.3** — MCP-first API (web UI + AI agents as equal clients)

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Astro + React islands |
| Hosting | GitHub Pages |
| Search (MVP) | Nav sidebar |
| Search (v0.2+) | Anvil MCP server |
| Auth | GitHub repo visibility |

## License

MIT
