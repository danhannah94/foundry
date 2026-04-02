#!/bin/sh
# Foundry SSR Entrypoint
# Starts both the Express API server and the Astro SSR server

# Decode deploy key from environment (if provided as base64)
if [ -n "$DEPLOY_KEY_B64" ] && [ -n "$DEPLOY_KEY_PATH" ]; then
  mkdir -p "$(dirname "$DEPLOY_KEY_PATH")"
  echo "$DEPLOY_KEY_B64" | base64 -d > "$DEPLOY_KEY_PATH"
  chmod 600 "$DEPLOY_KEY_PATH"
  echo "Deploy key written to $DEPLOY_KEY_PATH"
fi

# Start API server in background (port 3001)
echo "Starting API server on port 3001..."
node packages/api/dist/index.js &

# Start Astro SSR server as main process (port 4321)
echo "Starting Astro SSR server on port ${PORT:-4321}..."
HOST=0.0.0.0 PORT=${PORT:-4321} exec node packages/site/dist/server/entry.mjs
