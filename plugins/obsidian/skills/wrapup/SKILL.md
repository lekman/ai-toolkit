---
name: wrapup
description: End-of-session helper that lists today's open dashboard items across all clients and lets the user multi-select which to tick. Use when the user says "/obsidian:wrapup", "wrap up the session", or after running "/todo:wrapup".
user-invocable: true
allowed-tools: Read, Edit, Bash, AskUserQuestion, mcp__plugin_tasks_tasks__client_list, mcp__plugin_tasks_tasks__task_search, mcp__plugin_tasks_tasks__task_get, mcp__plugin_tasks_tasks__task_complete
---

# Session Wrapup: Tick Completed Tasks

Catch-all for completions that did not flow through `.tmp/TODO.md` (chat-only acknowledgements, work tracked outside the per-repo task file).

## Step 1: Resolve Config

Read `~/.claude/obsidian.json`, resolve vault and dashboard paths.

## Step 1b: Clients in the Task Database

A client has moved when its group in `Dashboard.md` holds the line `Moved to the tasks database` ([the dashboard structure](../../rules/dashboard-structure.md#clients-in-the-task-database)). Its items then live in the task database, and the `tasks` MCP tools (from the tasks plugin) change them. Find the client's id with `client_list`, matching its name case-insensitively. Every write takes `by`: your session name, as other sessions address you. The dashboard guard refuses an item written under a moved client, so never fall back to `Dashboard.md` for one. If this session has no `tasks` MCP tools loaded (a session started before the plugin was installed or updated), run the same operations with the `tasks` command from Bash instead: `tasks --help` lists them, and `--by` takes your session name. If `tasks` is not found, install it once with `python3 ~/.claude/plugins/cache/ai-toolkit/tasks/*/scripts/tasks install`.

For moved clients, take today's open items from the database instead of
`Dashboard.md`: `task_search` per moved client with `scheduledTo` today (it
includes overdue items). List them beside the dashboard items of clients that
have not moved, in one multi-select. For each selected database item,
`task_get` it for its `revision` and `task_complete` it with `by`. Guard and
edit `Dashboard.md` only for dashboard items, as below.

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
