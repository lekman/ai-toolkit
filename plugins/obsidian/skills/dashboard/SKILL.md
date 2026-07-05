---
name: dashboard
description: Open the Obsidian Dashboard.md as working context and report the active client based on the current working directory. Use when the user says "/obsidian:dashboard", "show my dashboard", or "what's on my plate".
user-invocable: true
allowed-tools: Read, Bash
---

# Obsidian Dashboard

Pin `Dashboard.md` as the working context, similar to `/obsidian:focus` but always the dashboard.

## Step 1 — Resolve config

```bash
CONFIG=~/.claude/obsidian.json
VAULT=$(jq -r .vault "$CONFIG")
DASHBOARD="$VAULT/$(jq -r .dashboard "$CONFIG")"
```

## Step 2 — Resolve active client from cwd

Walk up from `$(pwd)` and pick the longest path prefix in `clients`. Fall back to `default_client`.

```bash
CWD="$(pwd)"
ACTIVE=$(jq -r --arg cwd "$CWD" '
  [.clients | to_entries[] | select(.key as $k | $cwd | startswith($k))]
  | sort_by(.key | length) | reverse | .[0].value
' "$CONFIG")
[ -z "$ACTIVE" ] || [ "$ACTIVE" = "null" ] && ACTIVE=$(jq -r .default_client "$CONFIG")
```

The two-step pattern is intentional: jq's `// .default_client` fallback would evaluate the default against the array (after the pipe), not the root object, so the default lookup happens in a separate jq call.

## Step 3 — Refuse on iCloud conflict

```bash
ls "$VAULT"/Dashboard\ *.md 2>/dev/null && {
  echo "iCloud conflict copies present. Resolve before continuing."
  exit 1
}
```

## Step 4 — Read the dashboard and report

Read `$DASHBOARD` with the Read tool, then report a one-line summary to the user:

- Path and active client (e.g. `Dashboard.md — Active client: Acme`)
- Today's open vs done counts under `## Focus` (count `- [ ]` and `- [x]` under the heading matching today's date — formats `### <Weekday> <day> <Month>` and `## <Weekday> <day> <Month>` both appear).

Today's date format: use `date "+%A %-d %B"` (e.g. `Saturday 26 April`).
