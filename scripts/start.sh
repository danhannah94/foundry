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

# Wait for API to become healthy before starting proxy
echo "Waiting for API server..."
for i in $(seq 1 90); do
  if curl -sf http://localhost:3001/api/content/status > /dev/null 2>&1; then
    echo "API server ready after ${i}s"
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "ERROR: API server failed to start within 90s"
    exit 1
  fi
  sleep 1
done

# Start proxy as main process (port 4321)
# Routes /api/* and /mcp/* to Express API, everything else to Astro SSR
echo "Starting Foundry proxy on port ${PORT:-4321}..."
ASTRO_NODE_AUTOSTART=disabled exec node scripts/proxy.mjs
