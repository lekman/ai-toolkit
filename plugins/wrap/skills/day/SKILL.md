---
name: day
description: End-of-work-day wrap for the active client — reconcile the Obsidian dashboard against real state (TODO.md, GitHub PRs), roll open items to the next working day, archive the finished day, prune merged git branches and stale worktrees, then report the day. Use only when the user asks for it — "/wrap:day", "wrap up the day", "end of day". Never start it on your own initiative, including when a session looks finished.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion
---

# Wrap the Day

Close out one client's working day. Run once per client, from a repo belonging
to that client: the client is resolved from the working directory, never
hardcoded. If you worked for several clients today, run this skill once from
each client's repo.

## Step 1: Resolve Config and Active Client

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

The dashboard keeps exactly one day expanded. Today's day section sits
directly under `## Focus`, unprefixed — today _is_ the section outside the
blocks; there is no "Now" heading. Every other day (and `### Unscheduled — no
day assigned`) lives inside a collapsed callout that starts `> [!note]- Future`,
in chronological order, and every line inside it carries a `"> "` prefix: day
headings read `> ### Thursday 20 August`, checkboxes `> - [ ] …`, client
intention callouts nest as `> > [!note]`, and a blank line inside the block is
a lone `>` — an unprefixed blank line ends the callout and spills the days
below it onto the page. The `## Initiatives` body sits in its own collapsed
`> [!note]- All clients` callout under the same prefix rules. Reading or
writing a non-today day therefore means tolerating — and, when writing,
producing — the `"> "` prefix.

Today's section is the unprefixed one outside the block; everything this skill
writes to another day goes inside the block, prefixed.

## Step 2: Reconcile the Dashboard Against Real State

Scope: only the active client's items under today's heading in `## Focus`.

Collect evidence of what actually got done:

1. **Session tracker**: if `.tmp/TODO.md` exists in the repo, treat its Done
   rows as completions (same mapping as `/obsidian:sync-todo`).
2. **GitHub activity**. Pull today's PR activity for the user:

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
- Untick nothing silently: if a `- [x]` item looks _not_ done, ask.
- If an item's status is ambiguous, present the candidates with
  `AskUserQuestion` (`multiSelect: true`) rather than guessing.
- PRs authored or merged today that have no dashboard item: append them as
  `- [x] <client>: <PR title> ([#123](url))` under today's heading so the day's
  record is complete.

## Step 3: Roll Open Items to the Next Working Day

For each remaining `- [ ]` item belonging to the active client under today's
heading:

1. Compute the next working day (skip Saturday/Sunday):
   `date -v+1d "+%A %-d %B"`, adding days until the weekday is Mon–Fri.
2. Find that day inside the `> [!note]- Future` callout (`> ### <day>`), or
   create it there in chronological order — never as an unprefixed section.
3. Move the open items into it with a `"> "` prefix added to each line (`- [ ] …`
   → `> - [ ] …`); separating blank lines inside the block are a lone `>`.
4. **Drop any `🔄` claim marker as the item moves.** `/planner:next` writes it
   when a session takes a task, and a task rolled to tomorrow is no longer held
   by a session that has ended. Leaving it would make tomorrow's run skip work
   nobody is doing. Remove only that marker; `🧾`, `🚧` and the severity markers
   travel with the item.

## Step 4: Archive the Finished Day

Archiving is all-or-nothing per day, across all clients:

- If today's section still has open `- [ ]` items for **other** clients, leave
  the section in place and report which clients still need their own
  `/wrap:day` run.
- If today's section has **zero** open items left, cut the entire dated section
  from `Dashboard.md` and merge it into the month's work log — then perform
  the **day shift**: promote the earliest day section out of the
  `> [!note]- Future` callout (cut it, strip one `"> "` level from every line,
  insert it above the callout) so the dashboard is staged for the next
  morning. The run that archives the final client owns this; an empty Future
  block means nothing to promote. `/planner:today` Step 2b stays the fallback.

### Where the archive lives

One file per month, under a year folder:

```text
Archive/Work Logs/<YYYY>/<Month>.md      e.g. Archive/Work Logs/2026/August.md
```

Not a single `Archive.md` in the vault root. A vault that has one is carrying a
stale file from before the split — consolidate it into the month files and
delete it rather than writing to it.

The month comes from the day heading being archived and the year from today, so
archiving a December day in January needs the year checked by hand.

`/planner:archive` writes to the same place and translates the same way. Keep
the two in step; if they disagree, one of them is corrupting the log.

Create the month file if missing, with frontmatter and an `# Work Log: <Month>
<Year>` heading:

```markdown
---
type: reference
client: <the vault's default client>
status: active
tags: [work-log, archive]
created: <YYYY-MM-01>
---

# Work Log: <Month> <Year>
```

### The archive uses a different shape from the dashboard

Convert as you move, or the month file grows two competing formats:

|             | Dashboard (`## Focus`)      | Month work log                                 |
| ----------- | --------------------------- | ---------------------------------------------- |
| Day order   | chronological, oldest first | **reverse — newest day first**                 |
| Day heading | `### <Weekday> <D> <Month>` | `#### <Weekday> <D> <Month>`                   |
| Client      | `#### **<Client>**`         | `**<Client>**` (bold paragraph, not a heading) |

Keep each client's overview or intention callout with its items.

### One day, one entry

A day may already be in the month file: `/wrap:day` runs once per client, and a
day can be archived per client while another client is still working. So
**check before writing**.

- Day heading absent → insert the whole day, positioned by day number so newest
  stays first.
- Day heading present → do **not** add a second one. Merge each client's items
  into that day's matching `**<Client>**` sub-block, appending at its end. Add
  the sub-block only if that client has none yet.
- Deduplicate on the item line before appending. A re-run must not double
  entries.

Verify by counting checkboxes before and after: what leaves `Dashboard.md` plus
what was already in the month file should equal what the month file holds
afterwards. A mismatch means items were dropped or duplicated, and it is far
cheaper to catch here than in a 150 KB log a week later.

Never touch `## Initiatives` or `#### Other active work`.

## Step 5: Prune Git

In the current repo (and any sibling repos of the active client the user names):

```bash
git fetch --prune
```

- **Branches**: delete local branches whose upstream is gone (merged on remote
  and deleted). List them first, then delete with `git branch -D`:

  ```bash
  git branch -vv | awk '/: gone]/ {print $1}'
  ```

  Never delete the current branch or the default branch. If a gone branch has
  commits not reachable from the default branch **and** no closed/merged PR is
  found for it, skip it and report it instead of deleting.

- **Worktrees**: `git worktree prune`, then for each remaining worktree from
  `git worktree list`, remove it (`git worktree remove`) if its branch was
  deleted above or its upstream is gone. Skip any worktree with uncommitted
  changes and report it.

## Step 6: Report the Day

End with exactly this structure, kept short:

**Goal**: what today's overall goal was (infer from the dashboard section,
`.tmp/TODO.md`, and the session), and whether it was met.

**Achieved**

- short bullets, one per real outcome (merged PR, shipped fix, decision made)

**Tomorrow's intent**: one or two sentences.

**Tomorrow's tasks**

- the items rolled over in Step 3, plus anything newly agreed

If a handover note was written for today, link it here. If the rolled-over items
are being picked up by a different agent or machine, or by you after a gap long
enough that today's reasoning will be gone, suggest `/wrap:handover` for the
main thread. A rolled checkbox says what is left; it never says what will bite
you. Do not run it unasked.

## Constraints

- Scope every dashboard edit to the active client's items; other clients' lines
  are read-only except for the all-clients archive check in Step 4.
- Only edit under today's (and the rollover target's) heading in `## Focus`.
- Git deletions are limited to gone-upstream branches and their worktrees;
  anything with unpushed or uncommitted work is reported, never deleted.
