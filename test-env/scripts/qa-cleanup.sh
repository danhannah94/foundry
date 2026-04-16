#!/usr/bin/env bash
# Tear down a QA test-env instance.
#
# Usage:
#   test-env/scripts/qa-cleanup.sh <branch>
#
# Reads the state file written by qa.sh to determine the instance ID.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <branch>"
  exit 1
fi

BRANCH="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

SLUG="qa-$(echo "${BRANCH}" | tr '/' '-' | tr '[:upper:]' '[:lower:]')"
STATE_FILE="/tmp/qa-${SLUG}.state"

if [[ ! -f "${STATE_FILE}" ]]; then
  echo "✗ No state file found at ${STATE_FILE}"
  echo "  Was qa.sh run for branch '${BRANCH}'?"
  echo ""
  echo "  Manual teardown:"
  echo "    test-env/scripts/down.sh ${SLUG}"
  exit 1
fi

# shellcheck source=/dev/null
source "${STATE_FILE}"

echo "→ Tearing down test-env: ${INSTANCE_ID}"
"${SCRIPT_DIR}/down.sh" "${INSTANCE_ID}" 2>&1 | tail -5

rm -f "${STATE_FILE}"

echo ""
echo "✓ QA test-env torn down: ${INSTANCE_ID}"
