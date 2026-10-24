---
name: morning
description: Roll the dashboard to today, then schedule open work across the week against each client's hours, with no questions asked. Only moves items; never deletes, ticks, rewords or merges, and proves it with check-moves.ts before it finishes. Writes a log of every move to the vault. Built to run unattended from a scheduled routine. Use when the user says "/planner:morning", "plan the week", or "run the morning plan".
argument-hint: "[--dry-run]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, PushNotification, mcp__plugin_tasks_tasks__client_list, mcp__plugin_tasks_tasks__task_search, mcp__plugin_tasks_tasks__task_update
user-invocable: true
---

# Morning Plan

Roll the board to today, then fill the week by priority, up to each client's
hours.

## Operating Principle: Standing Consent, Full Record

[`/planner:triage`](../triage/SKILL.md) proposes and waits, because moving an
item changes the order every other skill reads. This skill moves items
without asking. The operator gave that consent once, by scheduling it. Two
things make that safe:

- **Nothing but moves.** No item is deleted, ticked, reworded or merged.
  [`check-moves.ts`](../../scripts/check-moves.ts) proves it against a
  snapshot. If the check fails, the run restores the snapshot and reports
  FAILED.
- **Every move is logged** with its reason, so the operator can read what
  changed and why.

Where the operator's order and the ranking below disagree, the ranking only
decides **which items move** when a day overflows. It never reorders the items
that stay, and moved items keep their relative order.

`--dry-run` does steps 0–2, writes the log with `(dry run)` in its title, and
changes nothing else.

## Configuration

`capacity` in `~/.claude/obsidian.json`, keyed by the client group name as it
appears on the dashboard (`#### **<Client>**`):

```json
"capacity": {
  "default_item_hours": 1,
  "clients": {
    "Acme":   { "mon": 8, "tue": 8, "wed": 8, "thu": 8, "fri": 8, "sat": 0, "sun": 0 },
    "Globex": { "mon": 0, "tue": 0, "wed": 0, "thu": 0, "fri": 0, "sat": null, "sun": null,
                "weekday_exception": { "max_hours": 1, "for": "productivity or cash flow / billing" } }
  }
}
```

- A number is hours for that client on that weekday. `null` means no cap.
- `weekday_exception` lets an item on a zero-hour weekday through when its
  `⏱` is at most `max_hours` and it serves the stated purpose. Log the reason.
- An item's hours are its `⏱` marker (`⏱ 30m`, `⏱ 2h`), otherwise
  `default_item_hours`.
- A client with no entry is not scheduled. Its items stay where they are, and
  the log says so.

No `capacity` block at all: roll, then stop and report "no capacity
configured". Do not guess hours.

## Clients in the Task Database

A client has moved when its group in `Dashboard.md` holds the line `Moved to the tasks database` ([the dashboard structure](../../../obsidian/rules/dashboard-structure.md#clients-in-the-task-database)). Its items then live in the task database, and the `tasks` MCP tools (from the tasks plugin) change them. Find the client's id with `client_list`, matching its name case-insensitively. Every write takes `by`: your session name, as other sessions address you. The dashboard guard refuses an item written under a moved client, so never fall back to `Dashboard.md` for one.

For moved clients, the run plans database items. The dashboard steps still run
for the day structure, day notes and calendar lines.

- **Roll**: open items scheduled before today count as today's; Step 2 places
  them. Nothing is carried by hand.
- **Plan**: candidates are the client's open items scheduled from today
  (overdue included) through the end of the planning window (Step 2):
  `task_search` with the `clientId` and that day as `scheduledTo`. Unscheduled items stay unscheduled. Leave blocked and
  claimed items where they are, and count none of their hours.
- **Hours** come from `effort`: XS 0.5, S 1, M 3, L 6, XL 12. An unsized item
  counts `default_item_hours`. Calendar lines still reduce the day's capacity.
- **Rank**: a `due` within 10 working days first, then the search order, which
  is the computed priority (business value against effort, raised by
  urgency). That replaces the `🔴` and `🟡` ranking.
- **Apply**: each move is one `task_update` with `by`, the `id`, the
  `revision` from the search, and only `scheduledFor` (a date, or `null` for
  Unscheduled). Passing nothing else is what keeps the run to moves only. A
  refused write (another session wrote first, or the item is claimed) is left
  alone and logged.
- **Verify**: `check-moves.ts` covers the dashboard. For the database, the
  item history records each move with this session's name; the log lists the
  same moves.

## Step 0: Setup

1. **Today** is `TZ=Europe/London date`, never the session's idea of the date.
   Format it the way the dashboard does: `Tuesday 29 September`.
2. **Guard** per [the write protocol](../../../obsidian/rules/dashboard-write.md).
   A non-zero exit stops the run.
3. **Snapshot for the check.** Copy the dashboard and this month's and last
   month's work logs into `~/.claude/dashboard-snapshots/morning-<timestamp>/`,
   keeping their vault-relative paths. Call that `$BEFORE`. A work log that
   does not exist yet is simply not copied.
4. If the vault is a git repo, commit `planner: pre-run <date>`. If it is not,
   skip both commits and do not log it as friction.

## Step 1: Roll

If the unprefixed day under `## Focus` is today, go to step 2.

Otherwise, repeat until it is today, at most 10 times:

```bash
bun "<skill-base-dir>/../../scripts/roll-forward.ts"
```

Roll carries open items into Tomorrow, files the day's ticked items and prose
in the work log, and shifts. A pass that does not change the unprefixed day is
a failure. Go to step 4 and fail it.

If the Tomorrow day is **later** than today (today had no heading of its own),
first move the Tomorrow day to the top of Future and put an empty
`> ### <today>` in Tomorrow, then shift. That is the one structural edit this
step makes by hand.

## Step 2: Plan

**The planning window** runs from today through Sunday. On a Saturday or
Sunday it runs through the following Sunday instead, so a weekend run plans
the coming working week, the same way `/planner:today` moves a weekend to
Monday. "Sunday" below means the end of this window. Without it, a weekend run
fits a week's open work into two days that usually have no hours, and sends
the rest to Unscheduled (24 Oct: about 64 items in a dry run).

Read only `## Focus`, with a script that prints each item line's number,
client, day and markers. `Dashboard.md` is over 100 KB, and a plain read
truncates. For each client with capacity:

1. **Hours per day**, for each day of the planning window. Take the configured capacity and
   subtract that client's `📅 HH:MM–HH:MM` calendar entries on that day.
2. **Candidates** are the client's open items on those days. Unscheduled
   items are never candidates: the operator holds them back on purpose, and
   only the operator gives them a day. Also leave these where they are and
   count none of their hours:
   - `🚧` blocked
   - `🔄` claimed
   - `📅` calendar entries
3. **Rank** the candidates, and break ties by current position:
   1. A hard date or expiry within 10 working days. Take it from the item's
      `📅` or its line. Open its `[Details]` note's `Current situation` only
      for items competing for the last hours of a day.
   2. Unblocks another person or a key date.
   3. `🔴`, then `🟡`, then the rest.
4. **Place** them. This is a placement, not a re-plan, so churn is the cost to
   minimise:
   - An item keeps its day while that day has hours for it, in rank order.
   - What overflows moves to the next day with room.
   - What fits nowhere through Sunday goes to Unscheduled.
   - Never move an item past its `📅` date or onto a past day.
   - A `weekday_exception` lets a small item onto a zero-hour weekday.

## Step 3: Apply

- Move whole item lines verbatim, with any indented continuation lines.
  Set the `"> "` depth for the destination band.
- In the destination group, insert after the last open item, above ticked
  ones. `📅` calendar runs stay at the top.
- A destination day without that client's group gets a new `#### **<Client>**`
  group. A weekend day without a heading gets one in Future, in date order.
- Never mix clients. Intention callouts stay with their day.
- No `(moved from …)` notes. The log records moves.

## Step 4: Verify

Copy the same files as step 0 into `$AFTER` (or point at the vault) and run:

```bash
bun "<skill-base-dir>/../../scripts/check-moves.ts" "$BEFORE" "$VAULT" \
  Dashboard.md "Archive/Work Logs/<year>/<Month>.md" … --today "<today>"
```

Any failure: restore every file from `$BEFORE`, mark the run FAILED with the
check's output, and go to step 5.

## Step 5: Log

Write `Planner/Log — <YYYY-MM-DD>.md` in the vault:

- **Moves**: one line each, as `item (first 8 words) | client | from → to | reason`.
- **Decide**: items moved on 3 or more of the previous logs, and `🚧` items
  with what unblocks them.
- **Capacity shortfall** per client and day, if any.
- **Friction**: anything slow, ambiguous or repeated this run, one line each,
  or "none".

If the vault is a git repo, commit `planner: <date>, N moves`.

## Step 6: Notify

A local push only, with no board content:

- `Board planned: N moves, M to decide. Log: <path>`
- `FAILED: <check>. Board restored.`

## Step 7: Self-Improve, When Warranted

Only if this run FAILED, or the same friction line appears in 2 or more of the
last 5 logs. Otherwise stop.

In `lekman/ai-toolkit`, on branch `planner/self-improve` (push to its open PR
if there is one; never open a second):

- Change only this skill and the rules files it reads. Never `check-moves.ts`
  or the only-moves rule.
- Cite the log lines behind each change. Prefer removing words and reads over
  adding steps.
- Open or update the PR with the evidence and the expected effect. Never
  merge. Never edit the installed plugin copy.

## Constraints

- **Only moves.** Delete, tick, reword or merge nothing.
- **Never write without the guard**, and never while a conflict copy exists.
- **Never touch `## Initiatives`**, a past day, or an item another session has
  claimed.
- **Never reorder the items that stay.**
