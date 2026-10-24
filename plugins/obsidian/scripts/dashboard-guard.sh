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

# A client whose group holds the line "Moved to the tasks database" has moved
# to the task database: its items live there, and the tasks MCP tools change
# them. A checkbox item under that client anywhere in ## Focus would never
# reach the database and would duplicate one that is there. Calendar lines
# (📅) stay allowed, because they are not tasks.
MOVED_MARKER="Moved to the tasks database"
moved_problems() {
  awk -v marker="$MOVED_MARKER" '
    function bare(line) { sub(/^(> ?)*/, "", line); return line }
    FNR == 1 { focus = 0; client = "" }
    /^## Focus[[:space:]]*$/ { focus = 1; next }
    focus && /^## / { focus = 0 }
    !focus { next }
    { s = bare($0) }
    s ~ /^#### / { client = s; sub(/^#### /, "", client); gsub(/\*/, "", client); sub(/[[:space:]]+$/, "", client); next }
    s ~ /^#{2,3} / || s ~ /^\[!note\]- (Tomorrow|Future)/ { client = ""; next }
    FNR == NR { if (client != "" && index(s, marker) == 1) moved[client] = 1; next }
    client != "" && (client in moved) && s ~ /^[[:space:]]*- \[[ xX]\]/ && index(s, "📅") == 0 {
      n++; names[client] = 1
      if (n <= 3) list = list (list == "" ? "" : "; ") "line " FNR ": " substr(s, 1, 60)
    }
    END {
      if (n > 0) {
        for (c in names) who = who (who == "" ? "" : ", ") c
        printf "%d items under clients that live in the task database (%s). Add or change them with the tasks tools (/tasks:work) and remove them here (%s%s)\n", n, who, list, (n > 3 ? "; and " (n - 3) " more" : "")
      }
    }
  ' "$DASHBOARD" "$DASHBOARD"
}

problems=$(shape_problems; moved_problems)
if [ -n "$problems" ]; then
  if [ "$MODE" = "--repair" ]; then
    echo "Repairing a misshapen dashboard:" >&2
  else
    echo "Dashboard.md needs repair before anything may be written:" >&2
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
