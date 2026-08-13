#!/usr/bin/env bash
#
# Stop a second pull request against the default branch while one of yours is
# still open, and point at `gh stack` instead.
#
# Two open pull requests against the same base are reviewed as though neither
# existed. The second one's diff includes the first one's changes, or conflicts
# with them, and the reviewer has no way to tell which is which. Stacking makes
# the dependency explicit: the second targets the first's branch, so its diff is
# only its own work.
#
# This is a speed bump, not a wall. Concurrent work is sometimes genuinely
# independent — an urgent fix in an unrelated area while a feature sits in
# review belongs on the default branch, not on top of that feature. Prefixing
# the command with STACK_OK=1 says so and lets it through.
#
# It fails open on purpose. No `gh`, no network, not a GitHub repo, unreadable
# payload — every one of those exits 0. A guard that blocks pull requests when
# it cannot reach GitHub is worse than no guard.

set -uo pipefail

payload="$(cat)"
command="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -z "$command" ] && exit 0

# Only `gh pr create`. `gh stack submit` opens its pull requests through the
# extension and never reaches this, so stacking is never blocked by the guard
# that asks for it.
printf '%s' "$command" |
  grep -Eq '(^|[^[:alnum:]_-])gh([[:space:]]+-[^[:space:]]+)*[[:space:]]+pr[[:space:]]+create' || exit 0

# The typed escape. Read from the command text rather than the environment:
# the hook is a separate process and never sees a variable the agent exported
# for `gh` alone.
printf '%s' "$command" | grep -Eq '(^|[[:space:]])STACK_OK=1' && exit 0

# The default branch, from the local remote HEAD first — no network, and it is
# the same answer `gh` would give.
default="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
[ -z "$default" ] &&
  default="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null)"
[ -z "$default" ] && exit 0

# What this pull request would target. An explicit --base naming something else
# is already a stack, so it passes.
base="$(printf '%s' "$command" |
  grep -oE '(--base|-B)[[:space:]]+[^[:space:]]+' | head -1 | awk '{print $2}' | tr -d '"'\''')"
[ -z "$base" ] && base="$default"
[ "$base" = "$default" ] || exit 0

open="$(gh pr list --author @me --state open --base "$default" \
  --json number,title,headRefName --limit 10 2>/dev/null)"
[ -z "$open" ] && exit 0
count="$(printf '%s' "$open" | jq 'length' 2>/dev/null || echo 0)"
[ "${count:-0}" -gt 0 ] 2>/dev/null || exit 0

top_number="$(printf '%s' "$open" | jq -r '.[0].number')"
top_head="$(printf '%s' "$open" | jq -r '.[0].headRefName')"

# Best effort: files this branch changes that the open pull request also
# changes. It sharpens the message — "the same files" is what makes someone
# stop and think — and is silently skipped when either side cannot be read.
overlap=""
mine="$(git diff --name-only "origin/${default}...HEAD" 2>/dev/null | sort -u)"
theirs="$(gh pr view "$top_number" --json files -q '.files[].path' 2>/dev/null | sort -u)"
if [ -n "$mine" ] && [ -n "$theirs" ]; then
  shared="$(comm -12 <(printf '%s\n' "$mine") <(printf '%s\n' "$theirs") | grep -c .)"
  if [ "${shared:-0}" -gt 0 ]; then
    overlap="It touches ${shared} of the same file(s), so it very likely belongs on top."
  fi
fi

{
  echo "Blocked: you already have an open pull request against ${default}."
  echo
  printf '%s' "$open" |
    jq -r '.[] | "  #\(.number)  \(.title)  [\(.headRefName)]"'
  echo
  echo "A second pull request against ${default} is reviewed as though the first"
  echo "did not exist — its diff carries the other's changes or conflicts with them."
  [ -n "$overlap" ] && echo "$overlap"
  echo
  echo "Stack this work on top instead:"
  echo
  echo "  gh stack init ${top_head}      # once, if #${top_number} is not a stack yet"
  echo "  gh stack add <this-branch>"
  echo "  gh stack submit --auto"
  echo
  echo "Needs the official extension and the repository setting:"
  echo "  gh extension install github/gh-stack"
  echo "  Settings > General > Pull Requests > stacked pull requests"
  echo
  echo "If this work is genuinely independent of the above — an unrelated area,"
  echo "an urgent fix — re-run the same command prefixed with STACK_OK=1."
} >&2

exit 2
