#!/bin/sh
# Foundry SSR Entrypoint
# Starts the Express API server, then the proxy (which handles Astro SSR + API routing)

# Decode deploy key from environment (if provided as base64)
if [ -n "$DEPLOY_KEY_B64" ] && [ -n "$DEPLOY_KEY_PATH" ]; then
  mkdir -p "$(dirname "$DEPLOY_KEY_PATH")"
  echo "$DEPLOY_KEY_B64" | base64 -d > "$DEPLOY_KEY_PATH"
  chmod 600 "$DEPLOY_KEY_PATH"
  echo "Deploy key written to $DEPLOY_KEY_PATH"
fi

# Start API server in background (port 3001)
echo "Starting API server on port 3001..."
ASTRO_NODE_AUTOSTART=disabled node packages/api/dist/index.js &

# Give the API time to start (Anvil model loading takes ~8s)
sleep 10

# Start proxy as main process (port 4321)
# Routes /api/* and /mcp/* to Express API, everything else to Astro SSR
echo "Starting Foundry proxy on port ${PORT:-4321}..."
ASTRO_NODE_AUTOSTART=disabled exec node scripts/proxy.mjs
