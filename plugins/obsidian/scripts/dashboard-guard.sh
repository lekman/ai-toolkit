#!/usr/bin/env bash
# Pre-write guard for Dashboard.md.
#
# Run this before any skill writes to the dashboard. It refuses on an iCloud
# conflict copy, snapshots the current file outside the vault, prunes old
# snapshots, and prints the snapshot path on stdout.
#
# The vault is not version-controlled and several agents write to one
# dashboard, so without a snapshot there is no way to tell afterwards whether
# a difference was yours, another session's, or a lost edit.
set -euo pipefail

CONFIG="${OBSIDIAN_CONFIG:-$HOME/.claude/obsidian.json}"
SNAP_DIR="${DASHBOARD_SNAPSHOT_DIR:-$HOME/.claude/dashboard-snapshots}"
KEEP_DAYS="${DASHBOARD_SNAPSHOT_DAYS:-14}"

[ -f "$CONFIG" ] || { echo "no config at $CONFIG" >&2; exit 1; }

VAULT=$(jq -r '.vault' "$CONFIG")
DASHBOARD="$VAULT/$(jq -r '.dashboard' "$CONFIG")"
BASE=$(basename "$DASHBOARD" .md)

[ -f "$DASHBOARD" ] || { echo "no dashboard at $DASHBOARD" >&2; exit 1; }

# An iCloud conflict copy means two writers already diverged. Writing now
# picks a winner silently, so stop and let the operator resolve it.
conflicts=$(find "$VAULT" -maxdepth 1 -name "$BASE [0-9]*.md" -print 2>/dev/null)
if [ -n "$conflicts" ]; then
  echo "iCloud conflict copies present. Resolve before writing:" >&2
  echo "$conflicts" >&2
  exit 1
fi

mkdir -p "$SNAP_DIR"
STAMP=$(date "+%Y%m%d-%H%M%S")
SNAP="$SNAP_DIR/$BASE-$STAMP.md"
cp "$DASHBOARD" "$SNAP"

# Keep the directory bounded. Snapshots are only useful while the edit that
# produced them is still in question.
find "$SNAP_DIR" -name "$BASE-*.md" -type f -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true

echo "$SNAP"
