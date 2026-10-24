---
name: tasks
description: How an agent works with dashboard items through the Atlas MCP tools — find work, claim it, record progress, finish it, and add new items — without editing Dashboard.md. Use whenever a session picks up, updates, adds or completes a task, or asks what is open for a client.
---

# Work With Atlas Tasks

The `atlas` MCP server holds every client's work items in one database. Use
its tools instead of editing `Dashboard.md`. Every write names you, lands in
the item's history, and is checked against what you last read.

## Who You Are

Every write takes `by`: your session name, exactly as other sessions address
you (for example `Iviron` or `Commander`). Use the same name every time. It
is how a claim is recognised as yours.

## Find Work

1. `client_list` once per session, for the client and workstream ids.
2. `task_search` with `clientId`. It returns open items, most important
   first, by computed priority and then urgency from the due date. Add
   `unclaimed: true` to see only what nobody holds.
3. `task_get` the one you choose, to read its summary, log and current
   `revision`.

Do not reorder by your own judgement: the order comes from business value,
effort and due date. If an item's order looks wrong, its value or effort is
wrong. Say so and set it with `task_update` rather than working around it.

## Claim Before You Start

`task_claim` before any work. A claim held by another agent is refused, and
that refusal is the point: pick another item or ask that agent. Do not pass
`force` unless the operator says the other agent has gone away.

If you stop without finishing, `task_release` so someone else can pick it up.

## Record Progress

- `task_log` for a progress note: 160 characters, the status at the time
  (`doing`, `blocked`, `review`). The log is append only and never edited.
- `task_update` for fields: `state`, `summary`, `scheduledFor`, `due`,
  `businessValue`, `effort`, `blocked` with `blockedOn`, and so on. Pass the
  `revision` you read. Set a field to `null` to clear it. Add `note` to log
  in the same call.
- Keep `summary` to the current state in about 550 characters. History
  belongs in the log, not the summary.
- Set `due` only for a real external deadline. A due date raises urgency, so
  an invented one makes every real deadline weaker.

## Finish

`task_complete` with the revision and a short note on what was done. It
records the day and clears your claim and any blocked details.

## Add New Work

`task_search` with `text` first, so the same work is not added twice. Then
`task_add` with the client, a title that states the outcome, and a workstream
from `client_list` when one fits. Set `businessValue` and `effort` when you
know them; until both are set, the stored `priority` is used.

## When a Write Is Refused

| Refusal                | What to do                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- |
| "is not at revision N" | Someone wrote first. `task_get`, check what changed, retry.                       |
| "is claimed by X"      | Leave it. Pick another item or ask X.                                             |
| "no item"              | The id is wrong. Find it with `task_search`.                                      |
| "item is not valid"    | The message names the field and the rule. Fix the value.                          |
| HTTP 401               | `ATLAS_MCP_TOKEN` is missing or wrong on this machine. Report it to the operator. |

Never retry a refused write unchanged, and never edit `Dashboard.md` to get
round a refusal.
