---
name: merge
description: Sweep an owner's open Dependabot PRs, verify each by build (repo CI if present, else a local build), admin-merge the safe ones, and report the rest as decisions. Use when the user says "/dependabot:merge", "merge safe dependabot PRs", or "go through my dependabot updates and merge what's safe".
argument-hint: [owner] [--repo owner/name] [--dry-run] [--no-local-build]
allowed-tools: Bash, Bash(gh *), Bash(git *), Bash(npm *), Read
user-invocable: true
---

# Dependabot merge sweep: $ARGUMENTS

Go through open Dependabot PRs, decide each by **build verification**, merge what
is safe, and hand back the rest as decisions. This skill merges — it changes the
remote. Default to a report first (`--dry-run`) if the operator has not already
said "merge what's safe".

## The safety bar

A PR is **safe to merge** when all of these hold:

1. The repo is **not archived** and **not a fork** (skip both — you cannot or
   should not merge them).
2. It is **mergeable** (no conflict). Conflicts are usually PRs that lost a race
   to a sibling on the same lockfile — comment `@dependabot rebase` and move on.
3. Its **build is verified green**:
   - **CI present**: the build/test checks pass. Treat `Lint`, `Type Check`,
     `Test`, `Build`, `Quality Gate`, `Security Scan` as the build. An
     **automation-review check that fails** (`Review`, `claude-review`,
     `copilot_code_review`) is **not** a build failure — those cannot run on
     Dependabot PRs (no secrets / no approver) and are the exact gate an
     admin-merge is meant to bypass. Merge anyway.
   - **No CI**: pull the repo and run its build locally (see Step 4). Green build
     → safe. This is the operator's "full build verification" for repos CI does
     not already cover.
4. Admin-merge is the standard for the operator's own repos: when the build is
   green, `gh pr merge --admin` bypassing a review-only ruleset gate is expected,
   not an exception. (Confirm this holds for the operator before the first run.)

**Not safe → report, do not merge:**

- Build/test/type-check **actually fail** → the dependency breaks the code. This
  is a code change, not a merge. Group these; a wave of the same major bump
  (e.g. TypeScript 6→7 across repos) is one migration, not N merges.
- Major version bumps are merged **if the build passes** (the operator's bar is
  CI-pass), but **name them in the report** — a green build does not prove a
  major runtime dependency is behaviourally safe.

## Step 1 — enumerate

```bash
OWNER=${OWNER:-$(gh api user --jq .login)}
gh search prs --owner "$OWNER" --state open --author "app/dependabot" \
  --limit 200 --json repository,number,title
```

Cache each repo's `isArchived` / `isFork` once (`gh repo view`), not per PR.

## Step 2 — status per PR

```bash
gh pr view "$num" --repo "$OWNER/$repo" \
  --json mergeable,mergeStateStatus,statusCheckRollup
```

List the **names** of failing checks, not just counts — that is how you tell a
failing `Review` (ignore) from a failing `Test` (hold):

```bash
gh pr view "$num" --repo "$OWNER/$repo" --json statusCheckRollup \
  --jq '[.statusCheckRollup[] | select((.conclusion//.state)=="FAILURE") | .name]'
```

`mergeStateStatus=BLOCKED` with no failing build check means a ruleset gate
(review), not a broken build — still safe under the bar above.

**Red CI is not proof of a broken build.** A frequent false negative: every job
fails **within ~1 second of starting** (compare `startedAt` across the failed
checks). Nothing can install deps and run lint/test in one second — those jobs
died at setup. The usual cause is that **Dependabot PRs do not receive repo
secrets**, so a setup step needing a token fails immediately and every job with
it. When you see this signature (all jobs fail near-simultaneously, seconds
after start), do not hold the PR on CI — fall through to a **local build**
(Step 4). If the local build is green, the dependency is fine and the PR is
safe; the red is an artifact of the CI's secret model, not the change.

Tell it apart from a real break: a real compile/test failure takes longer than
setup and usually fails **some** jobs, not all of them at the same instant.

## Step 3 — merge the safe ones

Merge method is set by each repo's ruleset; do not assume squash. Detect it, or
try in order and fall back on "not allowed":

```bash
for m in --squash --merge --rebase; do
  out=$(gh pr merge "$num" --repo "$OWNER/$repo" --admin $m --delete-branch 2>&1)
  echo "$out" | grep -qi 'not allowed' && continue
  break
done
```

The ruleset's allowed methods: `gh api repos/$OWNER/$repo/rulesets/<id> --jq
'.rules[]|select(.type=="pull_request").parameters.allowed_merge_methods'`.

Merge **oldest-first within a repo is not required**, but expect that once one
PR touching a lockfile merges, its siblings conflict. For each conflict, comment
`@dependabot rebase`; if the repo has the auto-merge workflow installed (see the
`onboard` skill) the rebased PR merges itself on green.

## Step 4 — local build for no-CI repos

When `statusCheckRollup` is empty, CI cannot vouch for the PR. Pull and build:

```bash
gh repo clone "$OWNER/$repo" /tmp/dependabot-merge/$repo -- -q   # once
# Establish the base builds first, so a red base is not blamed on the PR.
# Detect the build: package.json "build"/"test" script, Makefile, etc.
git fetch -q origin "pull/$num/head:pr-$num" && git checkout -q "pr-$num"
( cd "$SUBDIR" && npm ci --silent && npm run build )   # green exit => safe
git checkout -q "$DEFAULT_BRANCH"
```

Notes:
- Build the **base first** to prove the toolchain works here; only then trust a
  PR's red/green.
- Respect the manifest's node/engine version. If the local environment cannot
  match it, say so and do not guess — report the PR as unverified, not failed.
- `--no-local-build` skips this step and reports no-CI PRs as unverified.
- Verify each PR **independently** against the base. They will conflict with each
  other on merge; that is expected and handled in Step 3, not a build problem.

## Step 5 — report

Return four groups:

- **Merged** — repo#num, what it bumped; mark majors.
- **Held (your decision)** — repo#num and the failing build check; cluster
  related breakage (same major across repos) as one item.
- **Pending rebase** — conflicts asked to rebase; will merge when green.
- **Skipped** — archived, forks, and stale PRs (a >12-month-old PR is better
  closed and re-triggered than merged; recommend, do not close without asking).

State counts (open before, merged, still open) and note any merge that triggers
a release or deploy so the operator is not surprised.

## Notes

- This skill trusts the build, not the version number. That is deliberate and
  matches the operator's standard, but it is why majors are named in the report.
- It never closes PRs or changes rulesets. Merging and `@dependabot rebase`
  comments are the only writes.
