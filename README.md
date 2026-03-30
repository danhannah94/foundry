# 🏭 Foundry

Documentation platform for human-AI collaborative workflows.

MkDocs Material meets Google Docs meets podcast player — purpose-built for teams working with AI agents.

## Quick Start

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
