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
  them is a morning not spent on work that needs a whole head. The tag is the
  only signal for this: nothing infers "administrative" from the item text.

## Step 2: Refuse on iCloud Conflict

Same conflict-copy check as the other skills.

## Step 3: Locate or Create the Day Heading

Default heading: `date "+%A %-d %B"` (e.g. `Saturday 26 April`).

Today's section is the unprefixed one directly under `## Focus`; every other
day lives inside the collapsed `> [!note]- Future` callout with every line
`"> "`-prefixed (`> ### Thursday 20 August`, `> - [ ] …`, blank lines a lone
`>`). With `--day` targeting a future day, locate or create its heading
**inside** that callout in chronological order and write the new item with the
`"> "` prefix.

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
