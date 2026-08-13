---
name: tick
description: Mark a Dashboard.md task done by substring match against open items in the active client's tasks under today's heading. Use when the user says "/obsidian:tick <substring>", "mark X done", or "tick the X task".
user-invocable: true
allowed-tools: Read, Edit, Bash, AskUserQuestion
---

# Tick a Task

Find an open `- [ ]` item that contains the supplied substring, rewrite it to `- [x]`. Scoped to the active client and today's heading by default.

## Step 1 — Resolve config and active client

Same as the `dashboard` skill.

## Step 2 — Refuse on iCloud conflict

```bash
ls "$VAULT"/Dashboard\ *.md 2>/dev/null && {
  echo "iCloud conflict copies present. Resolve before continuing."
  exit 1
}
```

## Step 3 — Match

Read `Dashboard.md`. Under today's heading inside `## Focus`, find every `- [ ]` line whose text contains the supplied substring (case-insensitive). Default scope: lines starting with `<active-client>:`. `--all` widens to every client.

Resolution:

- **Exactly one match**: rewrite the line to `- [x]`. Preserve the rest of the line verbatim. Report `ticked: <line>`.
- **Multiple matches**: present them via `AskUserQuestion` and tick the chosen one.
- **Zero matches**: list today's open items for the active client (and `--all` items if zero in the active client) so the user can pick a better substring. Do not write.

## Step 4 — Edit

Use the `Edit` tool with the exact original line as `old_string` and the same line with `[ ]` → `[x]` as `new_string`. Single-line edit, no surrounding context needed because GFM checkboxes are unique line-level constructs.

## Constraints

- Touch only `## Focus`. Never edit `## Initiatives` or `#### Other active work`.
- Never edit lines outside today's heading even if `--all` is set; `--all` only widens the client scope.
- Never auto-create today's heading here — that's the `add` skill's job.
