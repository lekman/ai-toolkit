---
name: today
description: Show the day's plan from the Obsidian Dashboard.md — all clients, weekend fall-forward to Monday. The dashboard is the source of truth for "what's on my plate"; it is deliberately NOT in any RAG index, and calendars are a supplement, never the primary source. Use when the user says "/today", "what's my plan", "what's on my plate today", or "what's left today".
user-invocable: true
---

# Today's Plan

Answer "what is on my plate" from `Dashboard.md`, the task tracker. Do not
start with calendars or RAG search: task state lives only in the dashboard
(it is excluded from retrieval indexes by design, because an index is always
stale for state).

## Step 1: Resolve Config

```bash
CONFIG=~/.claude/obsidian.json
VAULT=$(jq -r .vault "$CONFIG")
DASHBOARD="$VAULT/$(jq -r .dashboard "$CONFIG")"
```

Run the [dashboard write protocol](../../../obsidian/rules/dashboard-write.md) before any edit: it refuses on
an iCloud conflict copy and snapshots the file first, so a later difference
can be attributed rather than guessed at. A non-zero exit stops the skill. Step 4c writes
meetings onto the dashboard, so this applies to this skill too.

## Step 2: Resolve the Target Day (Weekend Fall-Forward)

```bash
TODAY=$(date "+%A %-d %B")         # e.g. "Saturday 26 April"  (heading form)
TODAY_ISO=$(date +%F)              # e.g. 2026-04-26            (for ICS)
WEEKDAY=$(date +%u)                # 6 = Saturday, 7 = Sunday
MONDAY=$(date -v+mon "+%A %-d %B") # next Monday (macOS date)
MONDAY_ISO=$(date -v+mon +%F)
```

Carry both forms of the chosen target day forward: the heading form for
the dashboard (Step 3), the ISO form for the calendar fetch (Step 4).

Rules, in order:

1. Look for today's heading (`## <TODAY>` or `### <TODAY>`) with at least one
   open `- [ ]` item. If it is not found unprefixed, look inside the collapsed
   `> [!note]- Tomorrow` callout first, then `> [!note]- Future`, for
   `> ## <TODAY>` or `> ### <TODAY>` — found
   there, promote it first (Step 2b) and re-apply this rule.
2. **If today is Saturday or Sunday and rule 1 found nothing** (no heading,
   or a heading whose items are all ticked; completed counts as nothing
   left), use `MONDAY` as the target day and look for its heading instead.
   Label the output clearly:
   `Plan for Monday <d> <Month> (weekend — showing next workday)`, and if
   the weekend day existed fully ticked, lead with a one-line
   `<Weekday>: All done ✅`.
3. If neither heading exists (or neither has open items), say so plainly and
   offer `/obsidian:add` to plan the day. Do not go searching calendars or
   RAG as a substitute for a missing plan.

On a weekend fall-forward, Monday's heading normally sits inside the Future
block. Do **not** promote a future day — read its section in place, stripping
the prefix for display and extraction (`sed -E 's/^> ?//'` over the block
before the Step 3 awk).

## Step 2b: Promote Today out of the Tomorrow Band

The dashboard holds three bands under `## Focus`: today unprefixed, exactly
one day in a collapsed `> [!note]- Tomorrow` callout, and every later day in
a collapsed `> [!note]- Future` callout. See
[the dashboard structure](../../../obsidian/rules/dashboard-structure.md) for the prefix discipline, what
"tomorrow" resolves to, and the two-stage day shift. Reading a non-today day
means stripping one `"> "` level; writing one means producing it.

Normally the previous day's final archive run has already performed this
shift (see `/planner:archive` and `/wrap:day` — the run that archives a day's
last client promotes the next day out of the block). This step is the
fallback. When a day inside the block becomes today and is still in it,
promote it before anything else reads or writes the dashboard:

1. Cut the day's section — from its `> ### <day>` line to the line before the
   next `> ###`/`> ##` day heading (or the end of the callout).
2. Strip exactly one `"> "` level from every cut line (`> ### …` → `### …`,
   `> > [!note]` → `> [!note]`, lone `>` → blank line).
3. Re-insert the section directly **above** the `> [!note]- Tomorrow` line.
4. **Refill Tomorrow.** The band must hold exactly one day, so move the
   earliest day out of `> [!note]- Future` into the now-empty Tomorrow callout,
   at the same prefix depth. An empty Future leaves an empty Tomorrow, which is
   correct — the callout itself always stays.
5. Idempotent: a day already outside the bands is never promoted again, and
   both callouts must survive intact — check the line after each removed
   section still starts with `>`.

Today's day is normally found in Tomorrow. If it is deeper in Future instead —
a gap of unworked days — promote it from there and refill Tomorrow from what
is left, same two stages.

A dashboard with no `> [!note]- Tomorrow` callout at all predates this
structure: create the empty band above `> [!note]- Future` and carry on. The
first skill to touch the file migrates it, so there is no separate migration
step to forget.

## Step 3: List the Plate

Dashboard structure: day headings are `##` or `###`; **client groups are
`####` subheadings inside the day** (e.g. `#### **Acme**`). The section
therefore ends at the next heading of _2–3_ hashes: a `####` line is a
client group, not a boundary. Correct extraction:

```bash
awk -v d="$DAY" '
  function flush() {
    if (!client) return
    if (open == 0) print client ": All done ✅ (" done " ticked)"
    client = ""   # awk END runs even after exit — prevent a double flush
  }
  $0 ~ "^#{2,3} +"d" *$" { f=1; next }
  f && /^#{2,3}[^#]/ { flush(); exit }
  f && /^####/ { flush(); gsub(/[#*]/,""); sub(/^ +/,""); client=$0; open=0; done=0; next }
  f && /^- \[ \]/ { open++; print client ": " $0 }
  f && /^- \[x\]/ { done++ }
  END { flush() }
' "$DASHBOARD"
```

- **Default: all clients.** The plate view, grouped by the `####` client
  subheadings (fall back to `Client:` text prefixes for ungrouped items;
  anything else lands under "General").
- **Open items only** (`- [ ]`). Ticked `- [x]` items are never shown by
  default; `--done` adds them with a ✅.
- **Never drop a client group.** A client whose items are all ticked stays
  in the output as `<Client>: All done ✅ (n ticked)`. An empty group means
  the day went well, not that the client vanished. Only clients with no
  heading under the day at all are absent.
- `--client X` filters to one group (the All-done rule still applies to it).

Output: the target day as a heading line, then a numbered list per client
group. Keep it scannable: no tables, no commentary between items.

## Step 4: Day Shape: Travel and Meetings (Live ICS)

The overview is **weighted by the calendar**: travel and appointments are
the fixed shape of the day; tasks fill the space around them. When
`~/.claude/calendars.json` exists, fetch the day's events live (no cache,
no index, always fresh):

```bash
# TARGET_ISO is TODAY_ISO or MONDAY_ISO from Step 2. The skill's base
# directory is <plugin>/skills/today, so the script is two levels up.
bun "<skill-base-dir>/../../scripts/ics-today.ts" --date "$TARGET_ISO"
```

(The script lives at `scripts/ics-today.ts` in this plugin. It expands
DAILY/WEEKLY recurrences, spans multi-day events, so a trip started
yesterday still shapes today, and prints unsupported recurrence rules as
explicit warnings rather than dropping them. Calendars marked
`"kind": "travel"` in the config render in their own Travel section.)

Use the **target day** from Step 2: on a weekend fall-forward, fetch
Monday's events, not today's.

## Step 4b: Office 365 Calendar (Microsoft 365 Connector)

**Prefer the Microsoft 365 connector.** It reads the calendar over the
session's own authenticated connection, so nothing needs a client secret, a
refresh token, or a credential cache on disk.

Find it by **tool name, never by server id** — the MCP server id is an opaque
per-install UUID and hardcoding one breaks the skill on every other machine:

```text
ToolSearch: "select:outlook_calendar_search"
```

Then query the target day from Step 2:

```text
outlook_calendar_search(query: "*", afterDateTime: "<TARGET_ISO>T00:00:00",
                        beforeDateTime: "<TARGET_ISO>T23:59:59",
                        order: "oldest", limit: 25)
```

Reading the result:

- **`start` and `end` are `{dateTime, timeZone}` wall-clock pairs.** `dateTime`
  is local time in the named zone — **never re-interpret it as UTC**. Present it
  with its zone.
- **`attendees` present → a meeting.** `attendees` empty or null with the user
  as `organizer` → a **self-event**, which by convention is a todo: the subject
  is the task.
- **Skip `isCancelled`.** A cancelled event is not the shape of the day.
- **`calendarName`** maps the event to a client, same as an ICS feed name;
  fall back to `default_client` when it is null.
- **Paginate** while the response carries `nextOffset`; a day with more than 25
  events is rare but silently truncating one is not acceptable.

This path knows more than the ICS one does. `ics-today.ts` exposes only title,
time, all-day and calendar name, which is why Step 4c leans on a placeholder
title list. The connector returns `attendees`, `isAllDay`, `showAs` and
`categories`, so a self-event is identified by **having no attendees** rather
than by guessing from its title.

### Fallback: the local CLI

Only when the connector is unavailable — a headless or cron run, where an
interactively-authenticated MCP server may not be present — fall back to
`~/.claude/calendar.json` if it exists:

```bash
bun "$(jq -r .cli ~/.claude/calendar.json)" --date "$TARGET_ISO"
```

It returns **Meetings**, **Todos (from calendar)** and **Admin** sections.
Neither path available → skip this step silently; the plate alone is the
answer. A path that is available but **fails** is stated loudly, same rule as
ICS.

### Both Paths

Merge Meetings with the ICS ones, sorted by time. Calendar **todos** and
**admin** items stay display only: the dashboard is the task tracker, and a
self-event is a reminder, not a commitment. Promote those with
`/obsidian:add`. **Meetings** are different: Step 4c writes them to the
dashboard.

## Step 4c: Write Today's Meetings Onto the Dashboard

A meeting is a commitment, and commitments belong on the tracker next to the
work they displace. This step adds today's meetings to the day's client
groups so they can be ticked like anything else.

### Which Events Qualify

Include a **timed meeting on a client calendar**. Exclude:

- **All-day and multi-day events**, including everything on a calendar marked
  `"kind": "travel"`. Those describe the shape of the day, not a thing to do,
  and Step 5 already leads with them.
- **Calendar todos and admin items** from Step 4b — self-events with no
  attendees, and the admin calendars.
- **Placeholders**, matched case-insensitively on the title: `focus`,
  `blocked`, `busy`, `hold`, `private`, `lunch`, `travel`, `ooo`,
  `out of office`, `no meetings`, `tentative`.

This is deliberately generous: a real meeting is included even if it is
routine. Tighten the placeholder list rather than guessing at importance.
The placeholder list exists because `ics-today.ts` exposes only title, time,
all-day and calendar name; on the connector path, use `attendees` and
`showAs` directly instead of inferring from the title.

### Which Client

From the **calendar name** in `calendars.json`, which is already per client
(one feed per client). Connector events map by `calendarName`, falling back to `default_client` in
`~/.claude/obsidian.json`; CLI events belong to `default_client`. A calendar name that matches no
client group under today's heading is **reported, not written**: never invent
a `####` group.

### Entry Shape

A calendar icon takes the place the ticket link holds on a task line, so the
line reads the same way and sorts the same way:

```markdown
- [ ] 📅 09:15–09:45 **Morning sync**
- [ ] 📅 13:00–14:00 **Partner call prep**
```

No `[Details]` link: a meeting has no plan subpage. If one is later planned
with `/planner:goal`, that adds the link and the line becomes an ordinary
tracked item.

### Where It Goes

In **their own checkbox run**, directly after the client's intention callout
and before the first topical paragraph, ordered by start time. Fixed
commitments first is the same ordering Step 5 presents.

Not into an existing run. A client block's runs usually sit under a bold
paragraph that frames them ("Connection work — only if the partner replied"),
and a meeting inserted there reads as part of that topic. This is the same
rule `/planner:plan` step 3b.3 follows when it sinks ticked entries: a run's
paragraph is what gives it meaning, so calendar entries get a run of their
own rather than borrowing someone else's.

### Rules

- **Today onwards only.** Never write to a heading for a past day, and never
  backfill. A day that has already happened is a record.
- **Idempotent.** Match on icon + start time + title before writing. A second
  run the same day adds nothing.
- **Deduplicate the source.** The same event can arrive twice: a recurrence
  and its override, or a meeting on two feeds. Collapse on
  (start time, title, calendar) before writing.
- **Never tick, never delete.** If an event disappears from the calendar after
  it was written, leave the line; the operator decides. Report it as drift.
- **Never touch prose.** Same guard as everywhere else: intention callouts and
  paragraphs are the operator's.

Report one line: `dashboard: N meetings added (client: n, …), M skipped`.

## Step 5: Present the Overview

Order matters. Fixed commitments first, then the plate:

1. **Travel**, if any: lead with it. Being on a trip reframes everything
   below.
2. **Meetings**: timed list (ICS + O365 merged).
3. **Admin**: the admin-calendar checklist, if any.
4. **From calendar**: O365 todo items, if any, clearly separated from the
   dashboard plate.
5. **Tasks**: the full plate from Step 3, grouped per client. Re-read the
   dashboard after Step 4c so the meetings written there appear in the plate
   rather than only in the Meetings list.

Rules that always hold:

- The task list is never omitted, however busy the calendar looks: the
  transcript failure this skill exists to prevent was a calendar-only
  answer.
- A failed calendar fetch is stated loudly ("day view incomplete"), never
  smoothed over.
- No `calendars.json` → skip Step 4 silently; the plate alone is the
  answer.

If the user asks a forward-looking question beyond one day ("next week"),
same order per day: dashboard first, then ICS per day, then RAG for
context.
