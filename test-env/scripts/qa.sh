#!/usr/bin/env bash
# Boot a foundry test-env instance from any branch for QA.
#
# The Docker build clones the target branch from GitHub inside the container,
# so no local git checkout is needed. Works with a dirty working tree.
#
# Usage:
#   test-env/scripts/qa.sh <branch>
#
# Examples:
#   test-env/scripts/qa.sh main                      # regression QA against main
#   test-env/scripts/qa.sh ui/inline-draft-editing    # feature QA against a PR branch
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <branch>"
  exit 1
fi

BRANCH="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Slugify branch name for use as instance ID and state file name
SLUG="qa-$(echo "${BRANCH}" | tr '/' '-' | tr '[:upper:]' '[:lower:]')"
STATE_FILE="/tmp/qa-${SLUG}.state"

# Pick a free port in the 3001-3099 range
PORT=$((3001 + RANDOM % 99))

# Save state for cleanup
cat > "${STATE_FILE}" <<EOF
INSTANCE_ID=${SLUG}
PORT=${PORT}
BRANCH=${BRANCH}
EOF

echo "→ Booting test-env (instance: ${SLUG}, port: ${PORT}, branch: ${BRANCH})..."
echo "  Docker will clone the branch from GitHub. Build typically takes ~2-3 minutes."
echo ""

# Pass BRANCH to up.sh → docker compose → test-env/Dockerfile
export BRANCH
"${SCRIPT_DIR}/up.sh" "${SLUG}" "${PORT}"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  QA test-env ready"
echo "  URL:      http://localhost:${PORT}"
echo "  Branch:   ${BRANCH}"
echo "  Instance: ${SLUG}"
echo ""
echo "  When done, run:"
echo "    test-env/scripts/qa-cleanup.sh ${BRANCH}"
echo "════════════════════════════════════════════════════════════"
