---
name: sync
description: Reconcile the current repo's master-plan note in the Obsidian vault against merged PRs and closed tickets — move finished rows to Done, report drift, change nothing else. Use when the user says "/planner:sync", "sync the master plan", or after a merge lands.
user-invocable: true
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Planner: Sync

Verify, don't invent: walk the master-plan note's Active backlog; for each
row whose work is proven finished, set the subpage's frontmatter to
`status: done` (+ `completed:` date, `updated:`) and **delete the row**:
the master note holds open work only, the subpage is the archive. Successor
to the per-repo `master-plan:sync`. Runs silently: no questions, no
narration; one summary line at the end.

## Step 1: Resolve Context (Silent)

Same resolver as `/planner:plan`:

```bash
CTX=$(bun "<skill-base-dir>/../../scripts/resolve-context.ts")
```

Target note: `<plansDir>/<repo-name> — Master Plan.md`. If it does not
exist, stop: report "no master-plan note; run /planner:plan first".

## Step 2: Evidence of Completion

1. `gh pr list --state closed --limit 200 --json number,title,mergedAt,headRefName,url`:
   only `mergedAt != null` counts; a closed-unmerged PR proves nothing.
2. Tracker `jira`: ticket status Done/Closed via the repo's Jira CLI skill
   when available. Tracker `github`: `gh issue list --state closed`.
   Tracker `monday`: read the configured board with the Monday MCP connector
   and treat an item as finished only when its status column reads Done (or
   the board's equivalent end state). An unreachable connector proves nothing:
   leave the row alone and report the gap.
3. Match Active-backlog rows by Key against merged PR branches/titles and
   closed tickets.

## Step 3: Apply, Minimally

- For a matched row: update the subpage frontmatter first (`status: done`,
  `completed: <merge date>`, `updated: <today>`), then delete the row from
  Active backlog. Exactly the matched rows; nothing else in the note
  changes. A row with no subpage gets a stub subpage created (with
  frontmatter, `status: done`) before the row is deleted, so history is
  never dropped.
- A row whose PR merged but whose ticket is still open (or vice versa) is
  **not** moved; it is reported as drift.
- Edits stay inside the `<!-- planner:managed -->` fences. Operator prose is
  never touched.

## Step 4: Report

One line: `synced <note>: N completed (rows deleted, subpages archived), M drift (listed only if M > 0)`.
Drift items get one line each: key, what disagrees, where to look.
