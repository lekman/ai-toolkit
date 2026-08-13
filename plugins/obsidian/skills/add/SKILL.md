---
name: add
description: Append a new task as a checkbox under today's heading in Dashboard.md's Focus section, prefixed with the active client. Use when the user says "/obsidian:add <text>", "add task X", or "remind me to X".
user-invocable: true
allowed-tools: Read, Edit, Bash
---

# Add a Task

Append `- [ ] <client>: <text>` under today's heading in `## Focus`.

## Step 1 — Resolve config and active client

Same as the `dashboard` skill. Flags:

- `--client X` — override the cwd-resolved client
- `--day <date-string>` — append under a different day's heading (default: today). Date string uses the same format as the dashboard, e.g. `Sunday 27 April` or `Monday 28 April (Stockholm, on-site)`.

## Step 2 — Refuse on iCloud conflict

Same conflict-copy check as the other skills.

## Step 3 — Locate or create the day heading

Default heading: `date "+%A %-d %B"` (e.g. `Saturday 26 April`).

Look for `### <heading>` or `## <heading>` inside `## Focus`. If neither exists:

- Insert `### <heading>` immediately after the `## Focus` heading (and the existing intro paragraph if present).
- Heading level: use `###` to match the existing pattern for in-week days. The user may upgrade to `##` for a new week boundary manually.

## Step 4 — Append

Insert `- [ ] <client>: <text>` as the last line under the day heading (before the next `##`-or-`###` heading, or end of `## Focus` if last).

If the user's text already starts with `<known-client>:` (matches a value in `obsidian.json#clients`), do not double-prefix — use the user's text verbatim.

## Step 5 — Report

One line: `added: - [ ] <client>: <text> (under <heading>)`.
