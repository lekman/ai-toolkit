---
name: roll-call
description: Report which worker sessions are up, busy or missing against the commander roster, and which handoffs are still open. Read-only apart from closing ledger rows that a worker has already answered. Use when the user says "/commander:roll-call", "status", "who is running", "what are the agents doing", or "check on the other sessions".
user-invocable: true
---

# Roll Call

Answer "who is up and what are they doing" from two live sources: the session
list and the handoff ledger. Never answer from memory of the conversation.

## Step 1: Load the Roster and Ledger

```bash
ROSTER=~/.claude/commander.json
LEDGER=$(jq -r '.ledger // "~/.claude/commander/ledger.md"' "$ROSTER")
LEDGER="${LEDGER/#\~/$HOME}"
jq -r '.agents[] | [.name, .machine, (.always_on|tostring), (.owns|join("; "))] | @tsv' "$ROSTER"
[ -f "$LEDGER" ] && cat "$LEDGER"
```

If the roster file is missing, stop and tell the operator to copy
`roster.example.json` from this plugin to `~/.claude/commander.json`.

## Step 2: List Live Sessions

Call `ListAgents`. Match each roster `name` to a row by exact name. A session
name is its message address, so a near match (`globex-local` against
`Globex Local`) is a naming problem to report, not a match to assume.

Classify every roster agent:

| State        | Meaning                                                   |
| ------------ | --------------------------------------------------------- |
| **busy**     | Listed, status running                                    |
| **idle**     | Listed, status idle                                       |
| **missing**  | Not listed. For `always_on: true`, this is a fault        |
| **unnamed?** | Not listed, but an unnamed session on the same machine is |

List peer sessions that are not in the roster in one line at the end, so the
operator can name or close them. Do not message them.

## Step 3: Reconcile the Ledger

For each open ledger row (status `sent` or `working`):

- A reply in this conversation (a `<cross-session-message>` from that agent
  with the handoff id) moves it to `done`, `blocked` or `decision`. Update the
  row and the date.
- The agent is **missing** → mark the row `orphaned`. The work may be lost.
- The agent is **idle**, no reply, and it runs on this machine → the worker
  finished its turn without reporting. Say so; do not mark it done.
- The agent is on another machine → report the age of the handoff. No reply is
  not evidence of anything.

## Step 4: Report

One table, then open items. Keep it to one screen.

```markdown
| Agent        | State   | Open handoffs                   | Oldest |
| ------------ | ------- | ------------------------------- | ------ |
| Acme         | busy    | H-0929-1 release 2.4 to staging | 2 h    |
| Globex Local | missing | —                               | —      |
```

Then, only if non-empty:

- **Needs you**: rows in `blocked` or `decision`, with the worker's one line.
- **Faults**: always-on agents that are missing, orphaned handoffs, naming
  mismatches.

If a queue is building behind one busy agent, end with one line suggesting
`/commander:scale`.
