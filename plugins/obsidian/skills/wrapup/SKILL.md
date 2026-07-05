---
name: wrapup
description: End-of-session helper that lists today's open dashboard items across all clients and lets the user multi-select which to tick. Use when the user says "/obsidian:wrapup", "wrap up the session", or after running "/todo:wrapup".
user-invocable: true
allowed-tools: Read, Edit, Bash, AskUserQuestion
---

# Session Wrapup — Tick Completed Tasks

Catch-all for completions that did not flow through `.tmp/TODO.md` (chat-only acknowledgements, work tracked outside the per-repo task file).

## Step 1 — Resolve config

Read `~/.claude/obsidian.json`, resolve vault and dashboard paths.

## Step 2 — Refuse on iCloud conflict

Same conflict-copy check as the other skills.

## Step 3 — List today's open items

Find all `- [ ]` lines under today's heading inside `## Focus`. Include every client (no filtering — wrapup is intentionally cross-client).

If zero items: report "nothing open for today" and exit 0.

## Step 4 — Ask the user

Present the open items via `AskUserQuestion` with `multiSelect: true`. Each option is one item, label = the item text minus the `- [ ] ` prefix.

Add an explicit "None — close without changes" option in case the user invoked the skill but completed nothing.

## Step 5 — Tick selected items

For each selected item, use the `Edit` tool to rewrite `- [ ]` → `- [x]` on that exact line.

Report a one-line summary: `ticked N items: <comma-separated titles>`.

## Constraints

- Touch only items under today's heading. Never modify other days.
- Never touch `## Initiatives` or `#### Other active work`.
