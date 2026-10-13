#!/usr/bin/env bash
# Pre-write guard for Dashboard.md.
#
# Run this before any skill writes to the dashboard. It refuses on an iCloud
# conflict copy or a dashboard that is not in the three-band shape, snapshots
# the current file outside the vault, prunes old snapshots, and prints the
# snapshot path on stdout.
#
#   dashboard-guard.sh            guard a write: refuse, or snapshot
#   dashboard-guard.sh --check    after a write: check the shape only
#   dashboard-guard.sh --repair   snapshot a misshapen file, with a warning,
#                                 for a write that repairs the shape
#
# The vault is not version-controlled and several agents write to one
# dashboard, so without a snapshot there is no way to tell afterwards whether
# a difference was yours, another session's, or a lost edit.
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  "" | --check | --repair) ;;
  *) echo "usage: dashboard-guard.sh [--check | --repair]" >&2; exit 2 ;;
esac

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

# The shape rules from rules/dashboard-structure.md that a write most often
# breaks. Today is the only unprefixed day, and every line after the first band
# header sits inside a callout. Skills find today as the unprefixed heading
# with today's date, so a stray copy below the bands takes the writes meant for
# today (13 Oct: a day written below Future took the morning roll and a new
# item). plugins/planner/scripts/dashboard-shape.ts holds the same rules for
# the planner scripts; change both together.
shape_problems() {
  awk '
    function add(list, n, line) {
      return n <= 3 ? list (list == "" ? "" : "; ") "line " NR ": " substr(line, 1, 60) : list
    }
    function more(n) { return n > 3 ? "; and " (n - 3) " more" : "" }
    /^## Focus[[:space:]]*$/ { focus = 1; next }
    focus && /^## / { focus = 0 }
    !focus { next }
    /^### [^[:space:]]/ { days++; dq = add(dq, days, $0) }
    banded && $0 !~ /^[[:space:]]*$/ && $0 !~ /^>/ { out++; oq = add(oq, out, $0) }
    /^> \[!note\]- (Tomorrow|Future)[[:space:]]*$/ { banded = 1 }
    END {
      if (days > 1)
        printf "%d unprefixed day headings in ## Focus, and only today may be unprefixed (%s%s)\n", days, dq, more(days)
      if (out > 0)
        printf "%d lines below the Tomorrow and Future callouts have no \"> \" prefix, so they belong to no band (%s%s)\n", out, oq, more(out)
    }
  ' "$DASHBOARD"
}

problems=$(shape_problems)
if [ -n "$problems" ]; then
  if [ "$MODE" = "--repair" ]; then
    echo "Repairing a misshapen dashboard:" >&2
  else
    echo "Dashboard.md is not in the three-band shape. Nothing may be written until it is repaired:" >&2
  fi
  echo "$problems" | sed 's/^/  - /' >&2
  [ "$MODE" = "--repair" ] || {
    echo "Repair it by hand in Obsidian, or with the operator's go run this guard with --repair before the repairing write. See rules/dashboard-structure.md." >&2
    exit 1
  }
fi
[ "$MODE" = "--check" ] && exit 0

mkdir -p "$SNAP_DIR"
STAMP=$(date "+%Y%m%d-%H%M%S")
SNAP="$SNAP_DIR/$BASE-$STAMP.md"
cp "$DASHBOARD" "$SNAP"

# Keep the directory bounded. Snapshots are only useful while the edit that
# produced them is still in question.
find "$SNAP_DIR" -name "$BASE-*.md" -type f -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true

echo "$SNAP"
