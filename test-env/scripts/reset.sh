#!/usr/bin/env bash
# Convenience: tear down an instance and bring it back up with the same id.
#
# Usage:
#   test-env/scripts/reset.sh <instance-id> [port]
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <instance-id> [port]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE_ID="$1"
PORT="${2:-}"

"${SCRIPT_DIR}/down.sh" "${INSTANCE_ID}" || true

if [[ -n "${PORT}" ]]; then
  "${SCRIPT_DIR}/up.sh" "${INSTANCE_ID}" "${PORT}"
else
  "${SCRIPT_DIR}/up.sh" "${INSTANCE_ID}"
fi
