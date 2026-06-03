#!/usr/bin/env bash
# Refresh data/exercises.json from the private gym-bro-exercises repo.
#
# Strategy:
#   1. If ../exercises is a working copy of the private repo, pull and use it.
#   2. Otherwise, clone the repo to a temp dir over SSH.
#   3. Rebuild dist/exercises.json from exercises/*.json (requires jq).
#   4. Copy the resulting JSON to gym-bro-api/data/exercises.json.

set -euo pipefail

REPO_SSH="git@github.com:Sined385/gym-bro-exercises.git"
API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIBLING_DIR="$(cd "$API_DIR/.." && pwd)/exercises"
DEST="$API_DIR/data/exercises.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)" >&2
  exit 1
fi

if [[ -d "$SIBLING_DIR/.git" ]] && git -C "$SIBLING_DIR" remote get-url origin 2>/dev/null | grep -q "gym-bro-exercises"; then
  echo "Using sibling working copy: $SIBLING_DIR"
  SRC="$SIBLING_DIR"
  git -C "$SRC" pull --ff-only origin main
else
  SRC="$(mktemp -d)"
  trap 'rm -rf "$SRC"' EXIT
  echo "Cloning $REPO_SSH into $SRC"
  git clone --depth 1 "$REPO_SSH" "$SRC"
fi

echo "Rebuilding dist/exercises.json from $(ls "$SRC"/exercises/*.json | wc -l | tr -d ' ') files"
mkdir -p "$SRC/dist"
jq -s '.' "$SRC"/exercises/*.json > "$SRC/dist/exercises.json"

cp "$SRC/dist/exercises.json" "$DEST"
COUNT="$(jq 'length' "$DEST")"
echo "Wrote $COUNT exercises to $DEST"
