#!/usr/bin/env bash
# Point git at the version-controlled hooks in .githooks/.
#
# Hooks in .git/hooks are per-clone and unshared, so one goes missing the
# moment the repo is cloned again. core.hooksPath moves them into the tree,
# where they are reviewed like any other file.
#
# Run once per clone:
#   scripts/install-hooks.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "hooks: core.hooksPath → .githooks"

TERMS="scripts/client-terms.txt"
if [ -f "$TERMS" ]; then
  COUNT=$(grep -cvE '^\s*(#|$)' "$TERMS" || true)
  echo "terms: $TERMS ($COUNT patterns)"
else
  cp scripts/client-terms.example.txt "$TERMS"
  echo "terms: created $TERMS from the example — EDIT IT, it ships with none."
  echo "       It is gitignored: it names real clients, which is the leak"
  echo "       the check exists to prevent."
fi

echo
echo "Two hooks are now active:"
echo "  pre-commit  blocks staged FILE CONTENT naming a client"
echo "  commit-msg  blocks a COMMIT MESSAGE naming one — worse to get wrong,"
echo "              since only a history rewrite takes it back"
echo
echo "Both are skippable with --no-verify, which is why CI runs the same"
echo "checks on every push and pull request, reading the terms from the"
echo "CLIENT_TERMS repository secret."
echo
echo "To audit what is already committed:"
echo "  scripts/check-no-client-content.sh --history    # file content"
echo "  scripts/check-no-client-content.sh --messages   # commit messages"
