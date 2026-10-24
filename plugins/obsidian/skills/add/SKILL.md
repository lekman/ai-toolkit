---
name: add
description: Append a new task as a checkbox under today's heading in Dashboard.md's Focus section, inside the active client's group. Use when the user says "/obsidian:add <text>", "add task X", or "remind me to X".
user-invocable: true
allowed-tools: Read, Edit, Bash, mcp__plugin_tasks_tasks__client_list, mcp__plugin_tasks_tasks__task_search, mcp__plugin_tasks_tasks__task_add
---

# Add a Task

Append `- [ ] <text>` under today's heading in `## Focus`, inside the active
client's `####` group.

## Step 1: Resolve Config and Active Client

Same as the `dashboard` skill. Flags:

- `--client X`: override the cwd-resolved client
- `--day <date-string>`: append under a different day's heading (default: today). Date string uses the same format as the dashboard, e.g. `Sunday 27 April` or `Monday 28 April (Stockholm, on-site)`.
- `--admin`: tag the item as an administrative job by prefixing the text with
  `🧾`. [`/planner:next`](../../../planner/skills/next/SKILL.md) clears tagged
  items ahead of project work, because they finish fast and a morning spent on
  them is a morning not spent on work that needs a whole head.
- `--blocked`: tag the item as waiting on someone else by prefixing the text
  with `🚧`. `/planner:next` skips tagged items and reports them rather than
  starting them.
- `--due <date>`: record a real deadline by appending `📅 <YYYY-MM-DD>` to the
  item text. Only [`/planner:triage`](../../../planner/skills/triage/SKILL.md)
  reads it, to spread a week by delivery order. **A due date is not a
  priority**: within a day, position still decides what comes first, and a
  dated item is not started sooner for being dated. Omit it unless the date is
  externally fixed — a date invented to express urgency makes the one signal
  that means "this genuinely cannot slip" worthless.

Both tags are the **only** signal for their state: nothing infers
"administrative" or "blocked" from the item text, because a command run several
times a day cannot afford a guess that disagrees with itself between sessions.
Combine them with `--client` and `--day` freely; the tag goes at the front of
the text, before any severity marker.

## Step 1b: Clients in the Task Database

A client has moved when its group in `Dashboard.md` holds the line `Moved to the tasks database` ([the dashboard structure](../../rules/dashboard-structure.md#clients-in-the-task-database)). Its items then live in the task database, and the `tasks` MCP tools (from the tasks plugin) change them. Find the client's id with `client_list`, matching its name case-insensitively. Every write takes `by`: your session name, as other sessions address you. The dashboard guard refuses an item written under a moved client, so never fall back to `Dashboard.md` for one. If this session has no `tasks` MCP tools loaded (a session started before the plugin was installed or updated), run the same operations with the `tasks` command from Bash instead: `tasks --help` lists them, and `--by` takes your session name. If `tasks` is not found, install it once with `python3 ~/.claude/plugins/cache/ai-toolkit/tasks/*/scripts/tasks install`.

For a moved client, add the item to the database and stop; skip every step
below:

1. `task_search` with the `clientId` and a few words of the text, so the same
   work is not added twice. If it is already there, say so and stop.
2. `task_add` with `by`, the `clientId`, and the text as the `title`, stated
   as an outcome and without markers. Map the flags:
   - `--day` → `scheduledFor` as `YYYY-MM-DD`; today when no `--day` is given
   - `--admin` → `kind: "admin"`
   - `--blocked` → `blocked: true`, with `blockedOn` (`since` today,
     `waitingFor` who or what) when you know it
   - `--due` → `due`
   - a severity marker → `priority`: 🔴 high, 🟡 normal, 🟢 and ⚪ low
3. Report `added: <title> (<client>, <day or unscheduled>, <id>)`.

## Step 2: Guard the Write

Run the [dashboard write protocol](../../rules/dashboard-write.md) before any edit: it refuses on
an iCloud conflict copy and snapshots the file first, so a later difference
can be attributed rather than guessed at. A non-zero exit stops the skill.

## Step 3: Locate or Create the Day Heading

Default heading: `date "+%A %-d %B"` (e.g. `Saturday 26 April`).

Three bands, so `--day` routes to one of three places — see
[the dashboard structure](../../rules/dashboard-structure.md):

| `--day` resolves to | Goes in                                                 | Prefix |
| ------------------- | ------------------------------------------------------- | ------ |
| today               | the unprefixed section                                  | none   |
| tomorrow            | the `> [!note]- Tomorrow` callout                       | `"> "` |
| any later day       | the `> [!note]- Future` callout, in chronological order | `"> "` |

"Tomorrow" is the next working day, weekend-aware, and the Tomorrow band holds
**exactly one** day: a `--day` that resolves past it belongs in Future, even if
Tomorrow is empty. Never create a second day inside Tomorrow.

Locate or create the day heading inside the right band and write the item with
the band's prefix. Find a band by its whole header line (`> [!note]- Tomorrow`
or `> [!note]- Future` and nothing else), never by matching that text inside a
longer line. The maintenance note at the top of `## Focus` describes the bands
in prose, and an edit anchored there splits it.

For today, insert directly under today's day heading, inside today's section,
anchored on the heading line or on the last item of the client group. Never
anchor on band text or on the maintenance note.

For today: look for `### <heading>` or `## <heading>` inside `## Focus`,
unprefixed and above the Tomorrow band. A heading with today's date inside a
band, or below one, is not today; the guard in Step 2 refuses a dashboard
that has one below the bands. If
neither exists (check the Future block too — a day found there gets promoted
per `/planner:today` Step 2b rather than duplicated):

- Insert `### <heading>` immediately after the `## Focus` heading (and the existing intro paragraph if present).
- Heading level: use `###` to match the existing pattern for in-week days. The user may upgrade to `##` for a new week boundary manually.

## Step 4: Locate the Client Group

A day is divided into **client groups**: `#### **<Client>**` subheadings
inside the day's section (e.g. `#### **Acme**`). The group is what assigns an
item to a client — the item text itself carries no `<Client>:` prefix.
The day's section therefore ends at the next heading of _2–3_ hashes; a
`####` line is a group boundary inside it, not the end.

Under the day heading, find `#### **<client>**` (match on the client name,
ignoring `#` and `*`, case-insensitively).

- **Found**: that group is the target.
- **Not found**: create it as the last group in the day, `#### **<client>**`
  followed by a blank line. Creating a group here is correct — the operator
  asked for this item. (`/planner:today` Step 4c is the opposite case: it
  never invents a group, because a calendar feed is not an instruction.)

If the user's text starts with `<known-client>:` (matches a value in
`obsidian.json#clients`), strip that prefix and use **that** client's group
instead of the cwd-resolved one. The prefix is how the operator overrides
discovery inline; it is never written to the file.

## Step 5: Append

Insert `- [ ] <text>` as the last checkbox line in the target group — before
the next `####` heading, the next `##`-or-`###` heading, or the end of
`## Focus`, whichever comes first. Inside a band the group also ends where the
callout ends, at the first line without `"> "`: the last group in Future ends
at the band's last prefixed line, not at whatever heading follows it. Write
the item with the band's prefix (`> - [ ] <text>`). An item placed after the
callout's end lands outside every day.

Never append after a trailing prose paragraph inside the group: a paragraph
frames the run of checkboxes beneath it, so an item placed under the wrong
paragraph reads as part of a topic it has nothing to do with. Where the group
ends in prose, open a new checkbox run after it.

Leave intention callouts (`> [!note] Intention: …`) and every other prose
line untouched.

Then run the guard's `--check` (Step 3 of the write protocol). It fails when
the item landed outside its band.

## Step 6: Report

One line: `added: - [ ] <text> (under <heading> › <client>)`. Say when the
client group was created rather than found.
