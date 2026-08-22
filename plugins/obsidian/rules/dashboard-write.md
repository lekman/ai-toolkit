# Writing to Dashboard.md

Every skill that edits `Dashboard.md` follows this protocol. It is written
once here and referenced, not restated: the same rule copied into nine skills
is nine rules that drift.

## Why

The dashboard is a plain markdown file in an iCloud-synced vault. It has **no
version control**, and several agents write to it — a local session, a session
on another machine, and the operator in Obsidian. Writes are last-writer-wins
with no merge and no warning.

So a difference noticed after the fact cannot be attributed. Was it your edit,
another session's, or an edit that was lost? Without a snapshot there is no way
to answer, and the question comes up whenever two sessions run at once.

## The Protocol

### 1. Guard, before writing

```bash
SNAPSHOT=$("<obsidian-plugin-dir>/scripts/dashboard-guard.sh") || exit 1
```

Run [`scripts/dashboard-guard.sh`](../scripts/dashboard-guard.sh). It:

- **refuses** when an iCloud conflict copy exists (`Dashboard 2.md` and
  friends) and exits non-zero — two writers have already diverged, and writing
  now picks a winner silently;
- **copies** the current file to
  `~/.claude/dashboard-snapshots/Dashboard-<timestamp>.md`, outside the vault
  so the snapshot is neither synced nor able to become a conflict copy itself;
- **prunes** snapshots older than 14 days;
- **prints** the snapshot path.

A non-zero exit stops the skill. Report what it said; never write anyway.

### 2. Write

Make the smallest edit that does the job. Match on the exact line, never on
surrounding context that another session may have changed under you.

### 3. Verify, after writing

Re-read the lines you wrote and confirm they are there. If they are not,
another session wrote over you between your read and your write. Say so, and
recover from the snapshot rather than guessing at what was lost:

```bash
diff "$SNAPSHOT" "$DASHBOARD"
```

## Rules

- **Never write without the guard.** Not for one character, not for a claim
  marker.
- **Never write while a conflict copy exists.** Resolving it is the operator's.
- **Never edit the operator's prose.** Intention callouts, framing paragraphs
  and item wording are theirs. Skills add and remove checkboxes, markers and
  claims — not sentences.
- **Never delete a snapshot** to tidy up. The prune is time-based and bounded;
  a snapshot's whole value is being there when something looks wrong.
- **Touch only `## Focus`** unless the skill's own contract says otherwise.
  Never `## Initiatives` or `#### Other active work`.
