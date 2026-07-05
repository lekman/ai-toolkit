---
name: today
description: Show today's open tasks from the Obsidian Dashboard.md, filtered to the active client by default. Use when the user says "/obsidian:today", "what's on for today", or "today's tasks".
user-invocable: true
allowed-tools: Read, Bash
---

# Today's Tasks

List open `- [ ]` items under today's heading in `## Focus`. Default filter: active client (resolved from cwd). Pass `--all` to show every client's items.

## Step 1 — Resolve config and active client

Same as the `dashboard` skill — read `~/.claude/obsidian.json`, resolve vault path, resolve active client by walking cwd against the `clients` map.

`--client X` overrides the cwd-resolved client.

## Step 2 — Find today's heading

Today's heading uses `date "+%A %-d %B"` (e.g. `Saturday 26 April`). Match either `### <heading>` or `## <heading>` — both formats appear in the dashboard.

If today's heading does not exist, report "no items for today" and exit 0.

## Step 3 — List items

Extract lines between today's heading and the next `##`-or-`###` heading. Filter for `- [ ]` items.

- Default: only items whose text starts with `<active-client>:` (e.g. `- [ ] Acme: ...`).
- `--all`: every open item under the heading.

Output: numbered list, one per line. Each line includes the item text minus the `- [ ] ` prefix.

If zero items match: report "no open items for `<client>` today; pass `--all` to see other clients".
