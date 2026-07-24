---
name: triage
description: Scan an owner's repositories for Dependabot alert coverage and open dependency PRs, then report gaps and mergeable PRs grouped by status. Use when the user says "/dependabot:triage", "scan my repos for dependabot", or "which repos have dependabot warnings".
argument-hint: [owner] [--public] [--private] [--include-forks] [--alerts-only] [--prs-only]
allowed-tools: Bash, Bash(gh *), Read
user-invocable: true
---

# Dependabot triage: $ARGUMENTS

Report the Dependabot state across an owner's repositories. Read-only — this
skill never merges, closes, or changes settings. It produces a report the
operator acts on (often by running `/dependabot:onboard` on the gaps).

## Inputs

- `owner` — the GitHub user or org to scan. Default: the authenticated account
  (`gh api user --jq .login`).
- `--public` / `--private` — restrict visibility. Default: both.
- `--include-forks` — include forked repos. Default: **off**, because a fork's
  alerts belong to the upstream project, not the operator.
- `--alerts-only` / `--prs-only` — run just one half of the report.

## Step 1 — resolve the repo list

Owned, non-archived repos only unless flags say otherwise:

```bash
gh repo list "$OWNER" --limit 200 --no-archived --source \
  --json name,visibility --jq '.[] | "\(.name)\t\(.visibility)"'
```

Drop `--source` if `--include-forks` is set. Archived repos cannot serve alerts,
so they are excluded by default; mention any that were skipped.

## Step 2 — alert coverage per repo

For each repo, distinguish three states. A `403 ... disabled` response means the
repo is not watching at all — that is the actionable gap, not a clean result.

```bash
resp=$(gh api "repos/$OWNER/$name/dependabot/alerts?state=open&per_page=100" 2>&1)
# "message ... disabled"  -> DISABLED   (needs onboarding)
# JSON array, length 0    -> clean
# JSON array, length > 0  -> count by .security_advisory.severity
```

Group open alert counts by severity (`critical`, `high`, `medium`, `low`).

## Step 3 — open dependency PRs

```bash
gh search prs --owner "$OWNER" --state open --author "app/dependabot" \
  --limit 200 --json repository,number,title,updatedAt
```

For each, read mergeability and check status so the operator can see what is
ready:

```bash
gh pr view "$num" --repo "$OWNER/$repo" \
  --json mergeable,mergeStateStatus,statusCheckRollup
```

Summarise checks as counts by conclusion (e.g. `SUCCESS x6, FAILURE x1`).
`mergeStateStatus=BLOCKED` with green checks usually means branch protection is
waiting on a review, not a failure — say so rather than calling it blocked.

## Step 4 — report

Output two tables:

1. **Alert coverage** — one row per repo: `DISABLED` / `clean` / `N alerts
   [severity breakdown]`. List the DISABLED repos first; those are the gaps.
2. **Open Dependabot PRs** — grouped as: green & mergeable, failing checks,
   conflicted, and waiting-on-review.

Close with a short "what I'd do next": which repos to onboard, which PRs are
safe to merge. Recommend, do not act — acting is the operator's call or a
separate skill.

## Notes

- stdout and stderr interleave when looping `gh api` over many repos. Capture
  each response into a variable and branch on its content; do not pipe the loop
  straight to a formatter.
- Large accounts: `gh repo list` caps at the `--limit` you pass. State the cap
  in the report if the account has more repos than the limit.
