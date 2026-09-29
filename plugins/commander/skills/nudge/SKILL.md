---
name: nudge
description: Find roster worker sessions that have been idle for 10 minutes or more while they still have work, and nudge each one once, with a back-off. Asks for a status on an unanswered handoff, or tells an idle worker with agreed dashboard work to run /planner:next. Meant to run on a loop. Use when the user says "/commander:nudge", "nudge idle workers", "who is stuck", or runs "/loop 10m /commander:nudge".
user-invocable: true
---

# Nudge

Workers sometimes stop with work still open, for example when a background
task dies. `ListAgents` shows whether a session is idle now, but not for how
long, so this skill keeps its own record and nudges a worker only once it has
been idle for 10 minutes or more.

Run it on a loop in the commander session:

```text
/loop 10m /commander:nudge  # every 10 minutes: nudge idle workers that still have work
```

The [README's daily routine](../../README.md#daily-routine) explains what one
tick does, why the interval is 10 minutes, and how to stop the loop.

## Step 1: Load State

```bash
ROSTER=~/.claude/commander.json
LEDGER=$(jq -r '.ledger // "~/.claude/commander/ledger.md"' "$ROSTER")
LEDGER="${LEDGER/#\~/$HOME}"
IDLE=~/.claude/commander/idle.json
[ -f "$IDLE" ] || echo '{}' > "$IDLE"
jq '.agents' "$ROSTER"
cat "$LEDGER"
cat "$IDLE"
```

Call `ListAgents`. Work only with sessions whose name is in the roster. Ignore
every other session.

`idle.json` holds one record per agent:

```json
{
  "Acme": {
    "idle_since": "2026-09-29T10:12:00Z",
    "last_nudge": "2026-09-29T10:32:00Z",
    "nudges": 1,
    "fingerprint": "H-0929-3 sent 2026-09-29 10:05",
    "reported": null
  }
}
```

The `fingerprint` is the agent's open ledger rows (id, status and updated
time) joined into one string. When it changes, the worker has done something.

## Step 2: Decide per Agent

Go through the roster agents in roster order.

| `ListAgents` shows                    | Do                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Not listed                            | Remove its record. Missing sessions are `/commander:roll-call`'s job.                                                                                                                      |
| `busy`                                | Remove its record.                                                                                                                                                                         |
| `requires_action`                     | Never nudge. The agent is waiting on the operator. Report it once (Step 4) and set `reported` to `requires_action`, so the next tick stays quiet. Clear `reported` when the state changes. |
| `idle`, no record                     | Create the record with `idle_since` set to now. Nothing else this tick.                                                                                                                    |
| `idle`, `idle_since` under 10 min ago | Nothing.                                                                                                                                                                                   |
| `idle`, 10 min or more                | Go to Step 3.                                                                                                                                                                              |

## Step 3: Pick the Nudge

Compare the agent's current fingerprint with the one in its record. If it
changed, set `nudges` to 0 and `reported` to null, and store the new
fingerprint.

Then apply the back-off before anything else:

- `last_nudge` under 30 minutes ago → nothing this tick.
- `nudges` is 2 or more and the fingerprint has not changed → do not nudge
  again. Report the agent as stuck once (Step 4) and set `reported` to
  `stuck`.

Otherwise pick the first nudge that applies:

1. **Status nudge.** The agent has ledger rows in `sent` with no reply. Send
   one message that asks for each of them, with the ids in id order:

   ```text
   H-0929-3 STATUS: reply DONE | BLOCKED, or say why it is not complete
   ```

   Rows in `blocked` get no status nudge, because they wait on someone else.
   Rows in `decision` and `queued` get none either. A `decision` waits on the
   operator, and a `queued` row has not been sent.

2. **Next-item nudge.** All of these hold:
   - the agent has no rows in `sent`, `decision` or `queued` (rows in
     `blocked` do not count);
   - its day-plan check for today is `done` (see `/commander:dispatch`
     Step 3);
   - its client has open items under today's heading on the dashboard, read
     as `/commander:plan-check` Step 1 does.

   Send the message below. `/planner:next` chooses its own item (it skips
   blocked items and takes admin and quick wins first), so the commander
   cannot predict the pick. The guard for serial work therefore goes in the
   message, where the worker sees what was picked. For an agent with no
   `serial` list, leave out the last sentence.

   ```text
   Commander nudge: you are idle with agreed work for <client> today. Run /planner:next. If it picks serial work (<the agent's serial list>), do not start it: send Commander '<client> DECISION: /planner:next picked <item>' and stop.
   ```

   Serial work goes out only through `/commander:dispatch`, so a worker must
   not start it from a nudge.

3. **Nothing applies** → no nudge. An idle agent with no work is fine.

Send with `SendMessage` to the exact roster name. Set `last_nudge` to now and
add 1 to `nudges`. A nudge adds no ledger row, because it is not a handoff.

## Step 4: Write State and Report

Write `idle.json` back with every change from this tick.

Print one line per nudge or report, and nothing else:

```text
nudged Acme: H-0929-3 STATUS
nudged Globex: /planner:next
Admin needs you: waiting for approval (requires_action)
Acme stuck: nudged twice with no change since 10:32. Check the session.
```

If there is nothing to print, print `No nudges`. A loop tick runs many times
a day in the commander's context, so it stays this small.

## Constraints

- Nudge only roster agents, at most once per agent every 30 minutes.
- Never nudge an agent in `requires_action`.
- Do not change the ledger or the roster. This skill writes only `idle.json`.
