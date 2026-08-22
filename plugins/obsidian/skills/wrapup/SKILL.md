---
name: wrapup
description: End-of-session helper that lists today's open dashboard items across all clients and lets the user multi-select which to tick. Use when the user says "/obsidian:wrapup", "wrap up the session", or after running "/todo:wrapup".
user-invocable: true
allowed-tools: Read, Edit, Bash, AskUserQuestion
---

# Session Wrapup: Tick Completed Tasks

Catch-all for completions that did not flow through `.tmp/TODO.md` (chat-only acknowledgements, work tracked outside the per-repo task file).

## Step 1: Resolve Config

Read `~/.claude/obsidian.json`, resolve vault and dashboard paths.

## Step 2: Guard the Write

Run the [dashboard write protocol](../../rules/dashboard-write.md) before any edit: it refuses on
an iCloud conflict copy and snapshots the file first, so a later difference
can be attributed rather than guessed at. A non-zero exit stops the skill.

## Step 3: List Today's Open Items

Find all `- [ ]` lines under today's heading inside `## Focus` — today's
section is the unprefixed one; `> - [ ]` lines belong to later days inside
the collapsed `> [!note]- Tomorrow` and `> [!note]- Future` callouts and are
out of scope. Include every client (no filtering: wrapup is intentionally cross-client).

The day is divided into `#### **<Client>**` client groups, and an item belongs
to the group it sits under. The day's section therefore ends at the next
heading of _2–3_ hashes; a `####` line is a group boundary inside it, not the
end. Track the current group as you scan: it is the only thing that says which
client an item belongs to.

If zero items: report "nothing open for today" and exit 0.

## Step 4: Ask the User

Present the open items via `AskUserQuestion` with `multiSelect: true`. Each option is one item, label = `<client>: ` plus the item text minus the `- [ ] ` prefix. The list spans clients, so a label without its client is ambiguous.

Add an explicit "None: close without changes" option in case the user invoked the skill but completed nothing.

## Step 5: Tick Selected Items

For each selected item, use the `Edit` tool to rewrite `- [ ]` → `- [x]` on that exact line.

Report a one-line summary: `ticked N items: <comma-separated titles>`.

## Constraints

- Touch only items under today's heading. Never modify other days.
- Never touch `## Initiatives` or `#### Other active work`.
