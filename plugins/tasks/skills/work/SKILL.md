---
name: work
description: How an agent works with dashboard items through the tasks MCP tools — find work, claim it, record progress, finish it, and add new items — without editing Dashboard.md. Use whenever a session picks up, updates, adds or completes a task, or asks what is open for a client.
---

# Work With Tasks

The `tasks` MCP server holds every client's work items in one database. Use
its tools instead of editing `Dashboard.md`. Every write names you, lands in
the item's history, and is checked against what you last read.

## Who You Are

Every write takes `by`: your session name, exactly as other sessions address
you (for example `Builder` or `Commander`). Use the same name every time. It
is how a claim is recognised as yours.

## Without the MCP Tools

A session started before the tasks plugin was installed or updated has no
`tasks` MCP tools until it restarts. Use the `tasks` command from Bash
instead. It calls the same server, so the same checks, claims and history
apply:

```bash
tasks --by <your session name> search --client <id> --unclaimed
tasks --by <your session name> claim <id>
tasks --by <your session name> start <id> --note "picked up"
tasks --by <your session name> log <id> "halfway"
tasks --by <your session name> done <id> --note "merged"
tasks --by <your session name> add --client <id> --title "…" --day tomorrow --owner <who> --waiting-on <who>
```

`tasks --help` lists every command, and `--json` prints the server's answer.
If `tasks` is not found, install it once:
`python3 ~/.claude/plugins/cache/ai-toolkit/tasks/*/scripts/tasks install`.

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
  `businessValue`, `effort`, `blocked` with `blockedOn`, `pullRequests`, and
  so on. Pass the
  `revision` you read. Set a field to `null` to clear it. Add `note` to log
  in the same call.
- Keep `summary` to the current state in about 550 characters. History
  belongs in the log, not the summary.
- Set `due` only for a real external deadline. A due date raises urgency, so
  an invented one makes every real deadline weaker.

## Link Your Pull Requests

When you open a pull request for an item, add it to the item's
`pullRequests` with `task_update`, as `owner/repo#number`. Give the whole
list: read the item, append yours, and pass the revision. Dashboards then show
the item's own pull requests instead of every one that mentions its ticket.
Leave merged ones in the list; they show the work that was done.
From Bash, `tasks set <id> --pr owner/repo#number` does the read, the
append and the revision for you.

## Finish

`task_complete` with the revision and a short note on what was done. It
records the day and clears your claim and any blocked details.

## Add New Work

`task_search` with `text` first, so the same work is not added twice. Then
`task_add` with the client, a title that states the outcome, and a workstream
from `client_list` when one fits. Set `businessValue` and `effort` when you
know them; until both are set, the stored `priority` is used.

## Answer a Session You Cannot Reach

Some machines reach only the tasks server, for example a laptop behind a
tunnel. A session there can receive messages from other machines but has no
route to send one back. Answer through the task database instead:

- `message_send` with `to` (the other session's name, as it addressed you,
  for example Commander or Lekman), the `clientId` the message is about, and
  the text. A relay delivers it to that session.
- `message_inbox` with `to` set to your own session name reads the replies
  sent to you. Mark the ones you have read with `message_delivered`.

A message is about one client. A token limited to some clients sends and
reads only their messages.

## When a Write Is Refused

| Refusal                     | What to do                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------ |
| "is not at revision N"      | Someone wrote first. `task_get`, check what changed, retry.                          |
| "is claimed by X"           | Leave it. Pick another item or ask X.                                                |
| "no item"                   | The id is wrong. Find it with `task_search`.                                         |
| "item is not valid"         | The message names the field and the rule. Fix the value.                             |
| HTTP 401, or no tasks tools | The token in this machine's Keychain is missing or wrong. Report it to the operator. |

Never retry a refused write unchanged, and never edit `Dashboard.md` to get
round a refusal.
