---
name: focus
description: Load the most recently edited or created file in the Obsidian vault as context, so the user does not need to explain which file they are working on. Use when the user says "/obsidian:focus", "what am I working on", or "help with my current note".
user-invocable: true
allowed-tools: Read, Edit, Write, Glob, Bash
---

<!-- This skill follows the Agent Skills open standard: https://agentskills.io -->

# Focus

Load the most recently modified note in the Obsidian vault and make it the working context.

## Step 1 — Find the file

Resolve the vault from config, then get the most recently modified `.md` file, excluding system folders:

```bash
VAULT=$(jq -r .vault ~/.claude/obsidian.json)
find "$VAULT" \
  -name "*.md" \
  -not -path "*/.obsidian/*" \
  -not -path "*/.claude/*" \
  -not -path "*/Templates/*" \
  -not -path "*/.tmp/*" \
  -not -name "CLAUDE.md" \
  -not -name "Dashboard.md" \
  | xargs ls -t 2>/dev/null \
  | head -1
```

## Step 2 — Read the file

Read the full content of the file found above.

## Step 3 — Report context to the user

Tell the user in one line:

- The filename and its relative path within the vault
- The `client` and `type` from frontmatter (if present)
- The `stage` if it is a meeting note

Example: `Focused on: Clients/Acme/2026-03-02 Architecture Review.md (meeting · Acme · post-meeting)`

## Step 4 — Wait for instruction

Ask the user: "What would you like to do with this note?"

Then act on whatever they say, working directly on that file. Common tasks:

- Clean up and structure rough notes
- Extract and list action items
- Add or correct frontmatter
- Summarise the content
- Convert to a proper meeting note (run `/meeting-notes` logic inline)
- Add reference links or wikilinks to related notes in the vault

If the user passes arguments (`$ARGUMENTS`), treat them as the immediate instruction — skip asking and act on it directly. Example: `/obsidian:focus add action items` should load the file and immediately extract action items.
