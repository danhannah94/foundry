#!/usr/bin/env bash
# Boot a foundry test env instance. Parallel-safe.
#
# Usage:
#   test-env/scripts/up.sh                 # random id + random port
#   test-env/scripts/up.sh alpha           # explicit id, random port
#   test-env/scripts/up.sh alpha 54321     # explicit id and port
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

INSTANCE_ID="${1:-$(openssl rand -hex 4)}"
PORT="${2:-$((40000 + RANDOM % 10000))}"

export COMPOSE_PROJECT_NAME="foundry-test-${INSTANCE_ID}"
export PORT
export BRANCH="${BRANCH:-}"

COMPOSE_ARGS=(-f docker-compose.yml -f test-env/compose.test.yml)

echo "→ Booting foundry test env"
echo "  instance: ${INSTANCE_ID}"
echo "  port:     ${PORT}"
echo "  project:  ${COMPOSE_PROJECT_NAME}"

docker compose "${COMPOSE_ARGS[@]}" up -d --build

echo "→ Waiting for /api/health..."
for i in $(seq 1 90); do
  if curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    echo "  healthy after ${i}s"
    break
  fi
  if [[ $i -eq 90 ]]; then
    echo "FAIL: container did not become healthy within 90s"
    echo "─── last 100 log lines ───"
    docker compose "${COMPOSE_ARGS[@]}" logs --tail 100 || true
    exit 1
  fi
  sleep 1
done

echo "→ Triggering reindex..."
if curl -sf -X POST "http://localhost:${PORT}/api/reindex" >/dev/null 2>&1; then
  echo "  reindex accepted"
else
  echo "  (reindex call returned non-zero, continuing — file watcher may cover it)"
fi

echo "→ Running seed script..."
FOUNDRY_BASE_URL="http://localhost:${PORT}" node "${REPO_ROOT}/test-env/seed/fixture.mjs"

echo ""
echo "✓ foundry test env ready"
echo "  URL:      http://localhost:${PORT}"
echo "  instance: ${INSTANCE_ID}"
echo "  logs:     COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME} docker compose ${COMPOSE_ARGS[*]} logs -f"
echo "  teardown: test-env/scripts/down.sh ${INSTANCE_ID}"
