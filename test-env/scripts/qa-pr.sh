#!/usr/bin/env bash
# Boot a foundry test-env instance from a feature branch for QA.
#
# Saves the current branch, checks out the feature branch, builds and boots
# the test-env on a free port, and prints the URL the QA agent should use.
# Pair with qa-pr-cleanup.sh to tear down and restore the original branch.
#
# Usage:
#   test-env/scripts/qa-pr.sh <branch>
#
# Example:
#   test-env/scripts/qa-pr.sh ui/inline-draft-editing
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
# (ui/foo-bar -> pr-ui-foo-bar)
SLUG="pr-$(echo "${BRANCH}" | tr '/' '-' | tr '[:upper:]' '[:lower:]')"
STATE_FILE="/tmp/qa-${SLUG}.state"

# Pick a free port in the 3001-3099 range
PORT=$((3001 + RANDOM % 99))

# Save current branch state for cleanup to restore
ORIGINAL_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse HEAD)"

# Check for uncommitted changes — abort if found, don't auto-stash
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ Uncommitted changes detected — commit or stash before running QA."
  echo "  git status:"
  git status --short
  exit 1
fi

# Fetch and checkout the feature branch
echo "→ Fetching origin..."
git fetch origin "${BRANCH}" 2>&1 | tail -3

echo "→ Checking out: ${BRANCH} (was: ${ORIGINAL_BRANCH})"
git checkout "${BRANCH}" 2>&1 | tail -3

# Save state for cleanup
cat > "${STATE_FILE}" <<EOF
ORIGINAL_BRANCH=${ORIGINAL_BRANCH}
INSTANCE_ID=${SLUG}
PORT=${PORT}
BRANCH=${BRANCH}
EOF

echo "→ Booting test-env (instance: ${SLUG}, port: ${PORT})..."
echo "  Build typically takes ~2-3 minutes."
echo ""

# Delegate to existing up.sh
"${SCRIPT_DIR}/up.sh" "${SLUG}" "${PORT}"

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  QA test-env ready"
echo "  URL:      http://localhost:${PORT}"
echo "  Branch:   ${BRANCH}"
echo "  Instance: ${SLUG}"
echo ""
echo "  When done, run:"
echo "    test-env/scripts/qa-pr-cleanup.sh ${BRANCH}"
echo "════════════════════════════════════════════════════════════"
