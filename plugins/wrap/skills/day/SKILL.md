---
name: day
description: End-of-work-day wrap for the active client — reconcile the Obsidian dashboard against real state (TODO.md, GitHub PRs), roll open items to the next working day, archive the finished day, prune merged git branches and stale worktrees, then report the day. Use when the user says "/wrap:day", "wrap up the day", or "end of day".
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion
---

# Wrap the Day

Close out one client's working day. Run once per client, from a repo belonging
to that client — the client is resolved from the working directory, never
hardcoded. If you worked for several clients today, run this skill once from
each client's repo.

## Step 1 — Resolve config and active client

Same pattern as the obsidian plugin (both read `~/.claude/obsidian.json`):

```bash
CONFIG=~/.claude/obsidian.json
VAULT=$(jq -r .vault "$CONFIG")
DASHBOARD="$VAULT/$(jq -r .dashboard "$CONFIG")"
CWD="$(pwd)"
ACTIVE=$(jq -r --arg cwd "$CWD" '
  [.clients | to_entries[] | select(.key as $k | $cwd | startswith($k))]
  | sort_by(.key | length) | reverse | .[0].value
' "$CONFIG")
[ -z "$ACTIVE" ] || [ "$ACTIVE" = "null" ] && ACTIVE=$(jq -r .default_client "$CONFIG")
```

Refuse on iCloud conflict copies (`ls "$VAULT"/Dashboard\ *.md`), same as the
obsidian skills.

Today's heading format: `date "+%A %-d %B"` (matches `### <Weekday> <day> <Month>`
or `## <Weekday> <day> <Month>`).

## Step 2 — Reconcile the dashboard against real state

Scope: only the active client's items under today's heading in `## Focus`.

Collect evidence of what actually got done:

1. **Session tracker** — if `.tmp/TODO.md` exists in the repo, treat its Done
   rows as completions (same mapping as `/obsidian:sync-todo`).
2. **GitHub activity** — pull today's PR activity for the user:

   ```bash
   TODAY=$(date +%F)
   gh search prs --author @me --created "$TODAY" --json title,url,repository,state
   gh search prs --author @me --merged  "$TODAY" --json title,url,repository
   gh search prs --reviewed-by @me      --updated "$TODAY" --json title,url,repository,state
   ```

   Keep only PRs in the active client's repositories (match against the
   `clients` path prefixes / org names).

Then fix the boxes:

- Tick `- [ ]` items that the evidence shows are done.
- Untick nothing silently — if a `- [x]` item looks _not_ done, ask.
- If an item's status is ambiguous, present the candidates with
  `AskUserQuestion` (`multiSelect: true`) rather than guessing.
- PRs authored or merged today that have no dashboard item: append them as
  `- [x] <client>: <PR title> ([#123](url))` under today's heading so the day's
  record is complete.

## Step 3 — Roll open items to the next working day

For each remaining `- [ ]` item belonging to the active client under today's
heading:

1. Compute the next working day (skip Saturday/Sunday):
   `date -v+1d "+%A %-d %B"`, adding days until the weekday is Mon–Fri.
2. Create that heading under `## Focus` if it does not exist (same heading level
   as today's).
3. Move the open items there unchanged.

## Step 4 — Archive the finished day

Archiving is all-or-nothing per day, across all clients:

- If today's section still has open `- [ ]` items for **other** clients, leave
  the section in place and report which clients still need their own
  `/wrap:day` run.
- If today's section has **zero** open items left, cut the entire dated section
  from `Dashboard.md` and prepend it to `Archive.md` in the vault root (newest
  day first). Create `Archive.md` with a `# Archive` heading if missing.

Never touch `## Initiatives` or `#### Other active work`.

## Step 5 — Prune git

In the current repo (and any sibling repos of the active client the user names):

```bash
git fetch --prune
```

- **Branches** — delete local branches whose upstream is gone (merged on remote
  and deleted). List them first, then delete with `git branch -D`:

  ```bash
  git branch -vv | awk '/: gone]/ {print $1}'
  ```

  Never delete the current branch or the default branch. If a gone branch has
  commits not reachable from the default branch **and** no closed/merged PR is
  found for it, skip it and report it instead of deleting.

- **Worktrees** — `git worktree prune`, then for each remaining worktree from
  `git worktree list`, remove it (`git worktree remove`) if its branch was
  deleted above or its upstream is gone. Skip any worktree with uncommitted
  changes and report it.

## Step 6 — Report the day

End with exactly this structure, kept short:

**Goal** — what today's overall goal was (infer from the dashboard section,
`.tmp/TODO.md`, and the session), and whether it was met.

**Achieved**

- short bullets, one per real outcome (merged PR, shipped fix, decision made)

**Tomorrow's intent** — one or two sentences.

**Tomorrow's tasks**

- the items rolled over in Step 3, plus anything newly agreed

If a handover note was written for today, link it here. If the rolled-over items
are being picked up by a different agent or machine — or by you after a gap long
enough that today's reasoning will be gone — suggest `/wrap:handover` for the
main thread. A rolled checkbox says what is left; it never says what will bite
you. Do not run it unasked.

## Constraints

- Scope every dashboard edit to the active client's items; other clients' lines
  are read-only except for the all-clients archive check in Step 4.
- Only edit under today's (and the rollover target's) heading in `## Focus`.
- Git deletions are limited to gone-upstream branches and their worktrees;
  anything with unpushed or uncommitted work is reported, never deleted.
