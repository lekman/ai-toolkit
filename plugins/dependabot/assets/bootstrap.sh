#!/usr/bin/env bash
# Onboard the current repository to the Dependabot flow.
# Installed by the `dependabot` plugin from lekman/ai-toolkit.
#
# What it does, in order:
#   1. Enable Dependabot vulnerability alerts.
#   2. Enable automated security fix PRs.
#   3. Write .github/dependabot.yml            (skipped if it already exists).
#   4. Write .github/workflows/dependabot-auto-merge.yml (skipped if it exists).
#
# It never overwrites existing config. It does not commit or push; it leaves
# the new files staged in the working tree for you to review and commit.
#
# Usage:
#   bootstrap.sh            run against the repo of the current directory
#   bootstrap.sh --dry-run  print what would happen, change nothing
#
# Requirements: gh (authenticated, `repo` scope), run inside a git checkout.
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '%s\n' "$*"; }
run() {
	if [ "$DRY_RUN" = 1 ]; then
		say "  [dry-run] $*"
	else
		eval "$@"
	fi
}

# Resolve owner/repo from the gh context of the current directory.
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
say "Repository: $REPO"

# 1 + 2: enable alerts and automated security fixes.
say "Enabling Dependabot vulnerability alerts..."
run "gh api -X PUT \"repos/$REPO/vulnerability-alerts\" --silent"
say "Enabling automated security fixes..."
run "gh api -X PUT \"repos/$REPO/automated-security-fixes\" --silent"

# Locate the git root so files land in the right place.
GIT_ROOT="$(git rev-parse --show-toplevel)"

# 3: dependabot.yml
DEST_CFG="$GIT_ROOT/.github/dependabot.yml"
if [ -f "$DEST_CFG" ]; then
	say "Skipping .github/dependabot.yml (already present)."
else
	say "Writing .github/dependabot.yml"
	run "mkdir -p \"$GIT_ROOT/.github\" && cp \"$SCRIPT_DIR/dependabot.yml\" \"$DEST_CFG\""
fi

# 4: auto-merge workflow
DEST_WF="$GIT_ROOT/.github/workflows/dependabot-auto-merge.yml"
if [ -f "$DEST_WF" ]; then
	say "Skipping dependabot-auto-merge.yml (already present)."
else
	say "Writing .github/workflows/dependabot-auto-merge.yml"
	run "mkdir -p \"$GIT_ROOT/.github/workflows\" && cp \"$SCRIPT_DIR/auto-merge.yml\" \"$DEST_WF\""
fi

say ""
say "Done. Review the new files, then commit them."
say "Note: native auto-merge must be enabled in the repo settings"
say "(Settings > General > 'Allow auto-merge') for the workflow to take effect."
