#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# Foundry — Content Fetch Build Script
# Reads foundry.config.yaml, clones/pulls source repos,
# and copies markdown content into the Astro content dir.
# ─────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$REPO_ROOT/foundry.config.yaml"
CACHE_DIR="$REPO_ROOT/.cache/repos"
CONTENT_DIR="$REPO_ROOT/packages/site/content"

# ── Parse YAML config ────────────────────────────────────

parse_config() {
  if command -v yq &>/dev/null; then
    yq -o=json '.' "$CONFIG_FILE"
  else
    node "$REPO_ROOT/scripts/parse-config.mjs"
  fi
}

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: $CONFIG_FILE not found" >&2
  exit 1
fi

echo "==> Parsing foundry.config.yaml"
CONFIG_JSON=$(parse_config)

# ── Validate config ──────────────────────────────────────

SOURCE_COUNT=$(echo "$CONFIG_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.sources.length);
")

if [[ "$SOURCE_COUNT" -eq 0 ]]; then
  echo "Error: No sources defined in config" >&2
  exit 1
fi

# ── Prepare directories ─────────────────────────────────

echo "==> Clearing content directory"
rm -rf "$CONTENT_DIR"
mkdir -p "$CONTENT_DIR"
mkdir -p "$CACHE_DIR"

# ── Build git clone URL (with optional auth) ─────────────

git_url() {
  local repo="$1"
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo "https://x-access-token:${GITHUB_TOKEN}@github.com/${repo}.git"
  else
    echo "https://github.com/${repo}.git"
  fi
}

# ── Clone or pull a repo ─────────────────────────────────

ensure_repo() {
  local repo="$1"
  local branch="$2"
  local repo_name
  repo_name=$(echo "$repo" | tr '/' '_')
  local repo_dir="$CACHE_DIR/$repo_name"
  local url
  url=$(git_url "$repo")

  if [[ -d "$repo_dir/.git" ]]; then
    echo "    Updating $repo (branch: $branch)" >&2
    if ! git -C "$repo_dir" fetch origin "$branch" --depth 1 >&2 2>&1; then
      echo "Error: Failed to fetch $repo (branch: $branch)" >&2
      exit 1
    fi
    git -C "$repo_dir" checkout FETCH_HEAD --quiet
  else
    echo "    Cloning $repo (branch: $branch)" >&2
    if ! git clone --depth 1 --branch "$branch" "$url" "$repo_dir" >&2 2>&1; then
      echo "Error: Failed to clone $repo (branch: $branch)" >&2
      exit 1
    fi
  fi

  # Return only the repo path on stdout
  echo "$repo_dir"
}

# ── Process sources ──────────────────────────────────────

# Track cloned repos to avoid duplicates (bash 3.x compatible — no assoc arrays)
CLONED_KEYS=""
CLONED_DIRS=""
# Accumulate access.json entries
ACCESS_JSON="{"

echo "==> Processing sources"

for i in $(seq 0 $((SOURCE_COUNT - 1))); do
  # Extract source fields via Node
  eval "$(echo "$CONFIG_JSON" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const s = d.sources[$i];
    console.log('SOURCE_REPO=' + JSON.stringify(s.repo));
    console.log('SOURCE_BRANCH=' + JSON.stringify(s.branch));
    console.log('SOURCE_ACCESS=' + JSON.stringify(s.access || 'public'));
    console.log('SOURCE_PATHS=' + JSON.stringify(s.paths.join('|')));
  ")"

  # Clone/pull once per unique repo+branch
  repo_key="${SOURCE_REPO}@${SOURCE_BRANCH}"
  REPO_DIR=""

  # Check if we already cloned this repo+branch
  idx=0
  saved_ifs="$IFS"
  IFS=$'\n'
  for key in $CLONED_KEYS; do
    if [[ "$key" == "$repo_key" ]]; then
      REPO_DIR=$(echo "$CLONED_DIRS" | sed -n "$((idx + 1))p")
      break
    fi
    idx=$((idx + 1))
  done
  IFS="$saved_ifs"

  if [[ -z "$REPO_DIR" ]]; then
    REPO_DIR=$(ensure_repo "$SOURCE_REPO" "$SOURCE_BRANCH")
    CLONED_KEYS="${CLONED_KEYS}${CLONED_KEYS:+$'\n'}${repo_key}"
    CLONED_DIRS="${CLONED_DIRS}${CLONED_DIRS:+$'\n'}${REPO_DIR}"
  fi

  # Copy each path
  IFS='|' read -ra PATHS <<< "$SOURCE_PATHS"
  for src_path in "${PATHS[@]}"; do
    # Remove trailing slash for consistency
    src_path="${src_path%/}"
    full_src="$REPO_DIR/$src_path"

    if [[ ! -d "$full_src" ]]; then
      echo "Warning: Path '$src_path' not found in $SOURCE_REPO, skipping" >&2
      continue
    fi

    # Strip leading "docs/" prefix to get the destination path
    dest_rel="${src_path#docs/}"
    dest_dir="$CONTENT_DIR/$dest_rel"

    echo "    Copying $src_path -> content/$dest_rel/"
    mkdir -p "$dest_dir"
    cp -R "$full_src/." "$dest_dir/"

    # Add to access JSON (with trailing slash to match dir convention)
    if [[ "$ACCESS_JSON" != "{" ]]; then
      ACCESS_JSON="${ACCESS_JSON},"
    fi
    ACCESS_JSON="${ACCESS_JSON}\"${dest_rel}/\":\"${SOURCE_ACCESS}\""
  done
done

ACCESS_JSON="${ACCESS_JSON}}"

# ── Write .access.json ───────────────────────────────────

echo "==> Writing .access.json"
echo "$ACCESS_JSON" | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
" > "$CONTENT_DIR/.access.json"

echo "==> Done! Content fetched into packages/site/content/"
