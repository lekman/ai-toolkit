#!/usr/bin/env bash
# Pre-commit: auto-apply ESLint fixes to staged TypeScript/ESM files and
# re-stage them. Unfixable errors block the commit. Wired up as a trunk
# action (see .trunk/trunk.yaml) because trunk owns this repo's git hooks.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.mts' '*.mjs')

[ ${#files[@]} -eq 0 ] && exit 0

bunx eslint --fix --no-warn-ignored "${files[@]}"
git add "${files[@]}"
