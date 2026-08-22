---
name: purge
description: Clean up merged branches. Fast-forwards main to the remote, deletes local branches whose work is already on main, deletes merged remote branches, and turns on delete-branch-on-merge so the mess stops recurring. Use when the user says "/git:purge", "clean up branches", or "remove stale branches".
argument-hint: [--local-only] [--remote-only] [--dry-run] [--yes]
allowed-tools: Bash, AskUserQuestion
user-invocable: true
---

# Purge Merged Branches

Four jobs, in order: sync `main`, delete stale local branches, delete merged
remote branches, and set `delete_branch_on_merge` so the last two stop being
needed.

## What Stops a Deletion

Branch deletion is the one destructive act here, so it needs a **positive
signal that the work is already on `main`**. Three things are never deleted,
whatever the flags say:

- the default branch,
- the checked-out branch,
- any branch with an **open** pull request.

And one signal is never sufficient on its own:

> **"No remote branch" does not mean merged.** A branch that was never pushed
> also has no remote. Deleting on that signal alone destroys unpushed work.

## Step 1: Fetch and Prune

```bash
git fetch origin --prune
```

Do this first and never skip it. A branch whose remote was deleted on merge
keeps a **dangling upstream ref** locally, and every `ahead/behind` count
computed against it is stale. Most "is this merged?" confusion is just an
unpruned ref, and this one command resolves it.

## Step 2: Sync main

```bash
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
CURRENT=$(git branch --show-current)
```

- **On the default branch**: `git pull --ff-only`.
- **Elsewhere**: `git branch -f "$DEFAULT" "origin/$DEFAULT"`.

Both are fast-forward only, by design. If either refuses, local `$DEFAULT` has
commits the remote lacks: **stop and report it**. Never force past this — those
commits exist nowhere else.

Never use `git branch -f` on a checked-out branch; it does not update the
working tree.

## Step 3: Classify Each Local Branch

For every local branch that is not `$DEFAULT` and not `$CURRENT`, apply these
tests in order and stop at the first that answers.

### 3a. The Pull Request Is Authoritative

```bash
gh pr list --head "$b" --state all --json number,state --jq '.[0] | "\(.number) \(.state)"'
```

- `MERGED` → **stale, delete.**
- `OPEN` → **keep**, and say so; the branch is live work.
- No PR → fall through to 3b.

The PR is the authority because **this repository squash-merges** (check with
`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`).
A squash merge rewrites the branch into one new commit, so the branch's own
commit SHAs are **not** ancestors of `main`. That means `git branch --merged`
lists nothing, `git merge-base --is-ancestor` says no, and both are right and
useless. Do not read them as evidence the work is missing.

### 3b. Check for an Orphan History Before Trusting Any Count

```bash
git merge-base "$DEFAULT" "$b" >/dev/null 2>&1 || echo "orphan"
```

A non-zero exit means the branch shares **no common ancestor** with `$DEFAULT`
— unrelated histories, which happens after a history rewrite or an import.
For an orphan branch:

- `git diff $DEFAULT...$b` fails outright with `fatal: no merge base`,
- `git rev-list --count $DEFAULT..$b` and `git cherry` compare disjoint roots,
  so a count of "39 commits ahead" describes nothing.

Never let a raw ahead/behind count reach the report without this check first.
Fall through to 3c, which does not depend on shared history.

### 3c. The Content Test

Whether the histories relate or not, this asks the only question that matters:
does the branch hold a file `$DEFAULT` does not have?

```bash
git diff --diff-filter=A --name-only "$DEFAULT" "$b"
```

- **Empty** → every path on the branch exists on `$DEFAULT`. **Stale, delete.**
- **Non-empty** → list the paths and **ask the operator**. Absence from
  `$DEFAULT` is usually deliberate (a retired plugin, a pattern dropped
  repository-wide, a per-package lockfile that moved to the root), but "usually"
  is not a licence to delete. The operator decides; the skill does not guess.

Modified-file counts are **not** a test. A branch from three weeks ago differs
from `$DEFAULT` in dozens of files simply because `$DEFAULT` moved on. Only
files present on the branch and absent from `$DEFAULT` carry a risk of loss.

## Step 4: Record the Tips First

Before deleting anything, write every branch tip to a file and show the path:

```bash
OUT="${TMPDIR:-/tmp}/purged-branch-tips-$(git rev-parse --short HEAD).txt"
git for-each-ref --format='%(objectname) %(refname:short)' refs/heads > "$OUT"
```

Deleted local tips also stay in the reflog for `gc.reflogExpire` (90 days by
default), and a deleted remote branch is restorable from its pull request page.
Recovery is `git branch <name> <sha>`.

## Step 5: Delete the Local Branches

```bash
git branch -D "$b"
```

`-D`, not `-d`: after a squash merge `-d` refuses every branch in Step 3a, so
using it would just mean nothing is ever cleaned. The safety came from Step 3,
not from the flag.

## Step 6: Remote Cleanup

Skip on `--local-only`. For every remote branch other than `$DEFAULT`:

```bash
gh api repos/{owner}/{repo}/branches --jq '.[].name'
gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$b"
```

Delete only branches whose pull request is `MERGED` (Step 3a, same test).
A remote branch with **no** pull request is someone's work in progress,
possibly not yours: report it, never delete it. Never delete `$DEFAULT`, and
never `push --force`.

Then prune again:

```bash
git fetch origin --prune
```

Deleting a branch through the API does not touch this clone's
remote-tracking refs, so without this second prune `git branch -a` keeps
listing `origin/<deleted-branch>` and the next run re-reads branches that are
already gone.

## Step 7: Stop It Recurring

```bash
gh api repos/{owner}/{repo} --jq .delete_branch_on_merge
```

If `false`, set it:

```bash
gh api -X PATCH repos/{owner}/{repo} -F delete_branch_on_merge=true
```

This is a repository settings change, so **say what it does before doing it**:
every future pull request deletes its own branch on merge. It is not
retroactive, which is why Step 6 exists at all — branches merged before the
setting was turned on stay behind and look like unfinished work.

If it is already `true`, say so plainly and change nothing.

## Step 8: Report

One block, four lines, counts and names:

```text
main:    fast-forwarded 6b7e165 → dfafefc
local:   deleted 6 (feat/claude-docker, …), kept 1 (open PR #41)
remote:  deleted 2 (fix/maint-report-kind, …)
setting: delete_branch_on_merge already true
tips:    /tmp/purged-branch-tips-dfafefc.txt
```

Anything held back for a decision is listed with the reason, never folded into
a count. `--dry-run` runs every test and prints this block without deleting
anything or touching a setting.

## Constraints

- Never delete the default branch, the current branch, or a branch with an open
  pull request.
- Never delete a branch that fails every test in Step 3. Ask.
- Never force-update the default branch past a non-fast-forward.
- Never `push --force`, and never rewrite a remote branch.
- Never commit, stash, or discard working-tree changes to get a branch deleted;
  an uncommitted tree is a reason to stop, not an obstacle to clear.
