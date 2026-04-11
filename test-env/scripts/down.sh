#!/usr/bin/env bash
# Tear down a foundry test env instance and remove its volume.
#
# Usage:
#   test-env/scripts/down.sh <instance-id>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <instance-id>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

INSTANCE_ID="$1"
export COMPOSE_PROJECT_NAME="foundry-test-${INSTANCE_ID}"

docker compose -f docker-compose.yml -f test-env/compose.test.yml down -v

echo "✓ Torn down: ${INSTANCE_ID}"
