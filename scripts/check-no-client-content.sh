#!/usr/bin/env bash
# Fail if client-identifying content reaches this public repository.
#
# The repo is published. Client names, their repository names, ticket keys and
# meeting titles must never appear in it — examples use placeholders (Acme,
# Globex, PROJ-nnn). See plugins/obsidian/README.md for the three tiers.
#
# Terms live in scripts/client-terms.txt, one extended-regex per line, so the
# list can be updated without touching this script. That file is gitignored:
# it would otherwise be the leak it exists to prevent. Start from
# scripts/client-terms.example.txt. No list means no check — a contributor who
# works with no clients is never blocked.
#
# Modes:
#   (none)      tracked + untracked-but-not-ignored files in the working tree
#   --staged    the staged blobs only, as the pre-commit hook runs it
#   --history   every blob in every reachable commit
#
# --staged reads staged *content*, not the file on disk. A partially staged
# file can differ from its working copy, and the commit records the staged one.
#
# --history is the check that catches a leak already committed. The working
# tree going clean does not clean the history behind it: a fix commit corrects
# the tip and leaves the earlier blob exactly where it was, published. Stale
# local branches count as reachable, so prune before reading its output as a
# statement about what is published.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

TERMS_FILE="scripts/client-terms.txt"
if [ ! -f "$TERMS_FILE" ]; then
  echo "check-no-client-content: no $TERMS_FILE — skipping."
  echo "  cp scripts/client-terms.example.txt $TERMS_FILE and fill it in."
  exit 0
fi

PATTERN=$(grep -vE '^\s*(#|$)' "$TERMS_FILE" | paste -sd'|' -)
if [ -z "$PATTERN" ]; then
  echo "check-no-client-content: $TERMS_FILE has no terms — skipping."
  exit 0
fi

# The lockfile's integrity hashes collide with short terms, and these two files
# necessarily name the thing they look for.
EXCLUDE='^(bun\.lock|scripts/check-no-client-content\.sh|scripts/client-terms(\.example)?\.txt)$'

MODE="${1:-worktree}"
HITS=""

case "$MODE" in
  --history)
    # Walk every blob once. Paths repeat across commits; report each path once.
    HITS=$(git rev-list --objects --all \
      | awk 'NF>1 {print $1" "$2}' \
      | while read -r sha path; do
        echo "$path" | grep -qE "$EXCLUDE" && continue
        if git cat-file -p "$sha" 2>/dev/null | grep -IiqE "$PATTERN"; then
          echo "$path"
        fi
      done | sort -u)
    ;;

  --staged)
    FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -vE "$EXCLUDE")
    for f in $FILES; do
      match=$(git show ":$f" 2>/dev/null | grep -IinE "$PATTERN" | head -3)
      if [ -n "$match" ]; then
        HITS="${HITS}${f}:
$(echo "$match" | sed 's/^/    /')
"
      fi
    done
    ;;

  *)
    FILES=$(git ls-files --cached --others --exclude-standard | grep -vE "$EXCLUDE")
    [ -z "$FILES" ] && exit 0
    HITS=$(printf '%s\n' "$FILES" | tr '\n' '\0' |
      xargs -0 grep -IinE "$PATTERN" 2>/dev/null)
    ;;
esac

if [ -n "$HITS" ]; then
  echo "BLOCKED: client-identifying content found." >&2
  echo "$HITS" | sed 's/^/  /' >&2
  echo >&2
  echo "Replace with a placeholder (Acme, Globex, PROJ-123, acme-platform)." >&2
  if [ "$MODE" = "--history" ]; then
    echo "Committed already: fixing the working tree is not enough. The blob" >&2
    echo "stays in history until it is rewritten." >&2
  fi
  exit 1
fi

echo "check-no-client-content: clean (${MODE#--})"
