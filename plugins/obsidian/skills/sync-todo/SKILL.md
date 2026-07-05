---
name: sync-todo
description: Reconcile .tmp/TODO.md (a per-repo session task tracker) into Dashboard.md. Tick matching dashboard items when TODO.md rows move to Done; append new dashboard items for new In Progress / Backlog rows. Use when the user says "/obsidian:sync-todo", or after any edit to .tmp/TODO.md per the obsidian-todo-sync rule.
user-invocable: true
allowed-tools: Read, Edit, Bash, AskUserQuestion
---

# TODO ↔ Dashboard Sync

Reconcile the active repo's `.tmp/TODO.md` into the Obsidian `Dashboard.md`'s `## Focus` section. Triggered by the `obsidian-todo-sync` rule after edits to `.tmp/TODO.md`, or invoked manually.

## Step 1 — Resolve config and active client

Read `~/.claude/obsidian.json`. Resolve vault, dashboard path, and active client from cwd (longest path-prefix match against `clients`, fall back to `default_client`).

## Step 2 — Pre-checks

Exit 0 silently if `$(pwd)/.tmp/TODO.md` does not exist (this skill is a no-op in repos that don't use the TODO tracker).

Refuse if any `Dashboard <n>.md` conflict copy exists in the vault — surface the conflict to the user instead of writing.

## Step 3 — Hash short-circuit

Compute a hash of the relevant TODO.md sections (`## In Progress`, `## Backlog`, `## Done`) and the dashboard's `## Focus` section. Compare against `~/.claude/obsidian-sync.cache` keyed by repo path. If unchanged, exit 0 silently.

```bash
TODO=$(pwd)/.tmp/TODO.md
CACHE=~/.claude/obsidian-sync.cache
KEY=$(pwd)
HASH=$(awk '/^## (In Progress|Backlog|Done)$/{p=1} /^## (References|Conventions|Jira tickets)$/{p=0} p' "$TODO" | shasum | cut -d' ' -f1)
PREV=$(jq -r --arg k "$KEY" '.[$k] // ""' "$CACHE" 2>/dev/null)
[ "$HASH" = "$PREV" ] && exit 0
```

## Step 4 — Parse TODO.md rows

Extract rows from `## In Progress`, `## Backlog`, and `## Done` sections. For each row capture:

- Section (`in-progress` | `backlog` | `done`)
- Jira-key matches: regex `[A-Z][A-Z0-9]+-\d+`
- Title text (the first non-link, non-status cell — usually the row's leading description)

## Step 5 — Match against dashboard

Read `Dashboard.md`. Inside `## Focus` only:

For each TODO row:

- **Has Jira key**: find every dashboard `- [ ]` checkbox whose text contains the same key.
  - **In `## Done`** + matches found → tick all matching checkboxes (`- [ ]` → `- [x]`).
  - **In `## In Progress` or `## Backlog`** + no matching open or closed checkbox → append `- [ ] <client>: <row title> ([JIRA-KEY](https://<jira_host>/browse/JIRA-KEY))` under today's heading. Take `<jira_host>` from `~/.claude/obsidian.json#jira_host`, or reuse the URL pattern from existing TODO.md links if present.
  - **In `## In Progress`** + matching closed checkbox → no action (already done; don't reopen).
- **No Jira key**: substring match on the row title against open dashboard checkbox text.
  - Exactly one match in Done-section: tick.
  - Zero or multiple matches: log "no/ambiguous match for `<title>` — skipped" and skip. Do not guess.

## Step 6 — Locate or create today's heading

Today's heading: `date "+%A %-d %B"` (e.g. `Saturday 26 April`). Match `### <heading>` or `## <heading>` inside `## Focus`. If missing, insert `### <heading>` immediately after `## Focus` (and any intro paragraph).

## Step 7 — Apply edits

Use the `Edit` tool for ticks (one edit per `- [ ]` → `- [x]` line). Use a single multi-line `Edit` for inserts under today's heading.

## Step 8 — Update cache

Write the new hash back to `~/.claude/obsidian-sync.cache`:

```bash
TMP=$(mktemp)
jq --arg k "$KEY" --arg h "$HASH" '. + {($k): $h}' "$CACHE" 2>/dev/null > "$TMP" || echo "{\"$KEY\":\"$HASH\"}" > "$TMP"
mv "$TMP" "$CACHE"
```

## Step 9 — Report

One line per change:

- `ticked: <client>: <title> (matched JIRA-KEY)`
- `added: <client>: <title> ([JIRA-KEY](...))`
- `skipped: no/ambiguous match for "<title>"`

Silent on no-op (after the hash short-circuit, no further output).

## Constraints

- Touch only `## Focus` in `Dashboard.md`. Never touch `## Initiatives`, `#### Other active work`, or any other section.
- Never reopen a closed checkbox (`- [x]` → `- [ ]`).
- Never delete a checkbox even if the matching TODO row was removed — the user may have purged it deliberately; let them remove dashboard entries via Obsidian.
- Do not auto-edit TODO.md.
