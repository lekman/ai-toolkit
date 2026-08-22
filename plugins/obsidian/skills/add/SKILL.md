---
name: add
description: Append a new task as a checkbox under today's heading in Dashboard.md's Focus section, inside the active client's group. Use when the user says "/obsidian:add <text>", "add task X", or "remind me to X".
user-invocable: true
allowed-tools: Read, Edit, Bash
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
the band's prefix.

For today: look for `### <heading>` or `## <heading>` inside `## Focus`. If
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
`## Focus`, whichever comes first.

Never append after a trailing prose paragraph inside the group: a paragraph
frames the run of checkboxes beneath it, so an item placed under the wrong
paragraph reads as part of a topic it has nothing to do with. Where the group
ends in prose, open a new checkbox run after it.

Leave intention callouts (`> [!note] Intention: …`) and every other prose
line untouched.

## Step 6: Report

One line: `added: - [ ] <text> (under <heading> › <client>)`. Say when the
client group was created rather than found.
