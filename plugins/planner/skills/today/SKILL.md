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

Refuse on iCloud conflict copies (same guard as the dashboard skill):

```bash
ls "$VAULT"/Dashboard\ *.md 2>/dev/null && {
  echo "iCloud conflict copies present. Resolve before continuing."
  exit 1
}
```

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
   open `- [ ]` item.
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

## Step 4b: Office 365 Calendars (Live Graph, OAuth)

When `~/.claude/calendar.json` exists, also fetch the O365 day view. Its
`cli` field points at the calendar package's entrypoint, so this skill never
hardcodes a machine path:

```bash
bun "$(jq -r .cli ~/.claude/calendar.json)" --date "$TARGET_ISO"
```

It returns three sections: **Meetings** (events with attendees),
**Todos (from calendar)** (self-events: the subject is the task, by
convention), and **Admin** (recurring admin/deadline calendars as a
checklist). Merge its Meetings with the ICS ones, sorted by time.

Calendar **todos** and **admin** items stay display only: the dashboard is
the task tracker, and a self-event is a reminder, not a commitment. Promote
those with `/obsidian:add`. **Meetings** are different: they are written to
the dashboard by Step 4c below.

No `calendar.json` → skip silently. A failed fetch is stated loudly, same
rule as ICS.

## Step 4c: Write Today's Meetings Onto the Dashboard

A meeting is a commitment, and commitments belong on the tracker next to the
work they displace. This step adds today's meetings to the day's client
groups so they can be ticked like anything else.

### Which Events Qualify

Include a **timed meeting on a client calendar**. Exclude:

- **All-day and multi-day events**, including everything on a calendar marked
  `"kind": "travel"`. Those describe the shape of the day, not a thing to do,
  and Step 5 already leads with them.
- **Calendar todos and admin items** from `calendar.json` (Step 4b).
- **Placeholders**, matched case-insensitively on the title: `focus`,
  `blocked`, `busy`, `hold`, `private`, `lunch`, `travel`, `ooo`,
  `out of office`, `no meetings`, `tentative`.

This is deliberately generous: a real meeting is included even if it is
routine. Tighten the placeholder list rather than guessing at importance:
`ics-today.ts` exposes only title, time, all-day and calendar name, so
attendee count or organiser cannot be used to rank an event.

### Which Client

From the **calendar name** in `calendars.json`, which is already per client
(one feed per client). Events from the O365 `calendar.json` belong to
`default_client` in `~/.claude/obsidian.json`. A calendar name that matches no
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
