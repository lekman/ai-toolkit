---
name: tick
description: Mark a Dashboard.md task done by substring match against open items in the active client's tasks under today's heading. Use when the user says "/obsidian:tick <substring>", "mark X done", or "tick the X task".
user-invocable: true
allowed-tools: Read, Edit, Bash, AskUserQuestion
---

# Tick a Task

Find an open `- [ ]` item that contains the supplied substring, rewrite it to `- [x]`. Scoped to the active client and today's heading by default.

## Step 1: Resolve Config and Active Client

Same as the `dashboard` skill.

## Step 2: Guard the Write

Run the [dashboard write protocol](../../rules/dashboard-write.md) before any edit: it refuses on
an iCloud conflict copy and snapshots the file first, so a later difference
can be attributed rather than guessed at. A non-zero exit stops the skill.

## Step 3: Match

Read `Dashboard.md`. Prefixed `> - [ ]` lines belong to other days inside the
collapsed `> [!note]- Future` callout — never match or tick them. Under
today's heading inside `## Focus`, find every `- [ ]` line whose text contains
the supplied substring (case-insensitive).

**Scope is a client group, not a text prefix.** A day is divided into
`#### **<Client>**` subheadings, and an item belongs to the group it sits
under; the item text carries no client name. The day's section ends at the
next heading of _2–3_ hashes — a `####` line is a group boundary inside the
day, not the end of it.

- Default: items under the active client's `#### **<client>**` group.
- `--all`: every group under today's heading.

Only where a day has no `####` groups at all does the older
`- [ ] <Client>: …` text prefix apply as a fallback.

Resolution:

- **Exactly one match**: rewrite the line to `- [x]`. Preserve the rest of the line verbatim. Report `ticked: <line>`.
- **Multiple matches**: present them via `AskUserQuestion` and tick the chosen one.
- **Zero matches**: list today's open items for the active client (and `--all` items if zero in the active client) so the user can pick a better substring. Do not write.

## Step 4: Edit

Use the `Edit` tool with the exact original line as `old_string` and the same line with `[ ]` → `[x]` as `new_string`. Single-line edit, no surrounding context needed because GFM checkboxes are unique line-level constructs.

**Drop a `🔄` claim marker in the same edit.** `/planner:next` writes `🔄` when
it takes a task, and a finished task is not claimed — an unfinished-looking
marker on a ticked item is the loose end the claim exists to make visible.
Remove only that marker and the space after it; leave `🧾`, `🚧` and the
severity markers exactly as written.

## Constraints

- Touch only `## Focus`. Never edit `## Initiatives` or `#### Other active work`.
- Never edit lines outside today's heading even if `--all` is set; `--all` only widens the client scope.
- Never auto-create today's heading here: that's the `add` skill's job.
