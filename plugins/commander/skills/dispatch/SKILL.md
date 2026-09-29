---
name: dispatch
description: Hand a piece of work to the worker session that owns it, as a self-contained brief with a reply contract, and record it in the commander ledger. Use when the user says "/commander:dispatch <task>", "send this to Acme", "hand this off", "get Admin to do the timesheet", or picks an item from /planner:today to delegate.
user-invocable: true
---

# Dispatch

Send one task to one worker session. The message must let the worker start
without asking a question, and must tell it how to report back.

Dispatch only what the operator asked for, by naming the task or by choosing a
dashboard item. Do not delegate work on your own initiative.

## Step 1: Resolve the Owner

```bash
ROSTER=~/.claude/commander.json
jq '.agents' "$ROSTER"
jq -r '.out_of_scope_clients[]?' "$ROSTER"
```

Pick the agent in this order:

1. The operator named one → use it.
2. The task belongs to a client (dashboard group, repository, ticket key) → the
   agent whose `client` matches. If two match, prefer the one whose `owns`
   describes the task, then the `always_on` one.
3. Administration (timesheets, invoices, billing, expenses) → the agent that
   owns it in the roster.

If the client is in `out_of_scope_clients`, stop and say so. If nothing
matches, ask the operator with `AskUserQuestion`, listing the roster agents as
options.

Work in an agent's `serial` list (for example deployments and releases) always
goes to that agent and is never split across sessions, because two sessions
applying to one environment race each other.

## Step 2: Check the Owner Is Up

Call `ListAgents` and find the exact name.

- **Listed** (idle or busy) → continue. A busy session receives the message at
  its next tool round; it is queued, not lost.
- **Missing, `always_on: true`** → a fault. Tell the operator and give the
  start command as a Do item (Step 2a). Do not send.
- **Missing, `always_on: false`** → record the row as `queued` in the ledger
  and give the start command as a Do item. Send when it appears.

### Step 2a: Start Command

```bash
cd <cwd> && claude --remote-control "<name>"
```

`--remote-control` makes the session reachable from other machines. The name
must match the roster exactly, because the name is the message address.

## Step 3: Write the Brief

Allocate the next id: `H-<MMDD>-<n>`, where `n` counts today's rows in the
ledger. The first line of the message is the only part the worker's operator
sees without expanding it, so it carries the id and the task.

```text
Handoff H-0929-1 from Commander: <task in one line>

Goal: <the outcome, not the steps>
Context: <dashboard item, ticket, PR or vault note links; what is already done>
Constraints: <what not to touch; approvals needed; deadlines>
Done when: <an observable check: PR URL open and green, file exists, deploy recorded>

Report back with SendMessage to "Commander". First line:
  H-0929-1 DONE | BLOCKED | DECISION: <one line>
Then links only (PRs, runs, notes). Do not send transcripts or logs.
Send DECISION when the choice is the operator's; do not guess.
```

- Send text, not `@file` references. The receiver reads the message literally
  and an `@path` attaches nothing on its side.
- If the context runs past about 30 lines, write it as a vault note with
  `/wrap:handover` and put the note's path in `Context:`.
- Do not include secrets. A worker that needs a credential gets it through its
  own login, not from this message.

## Step 4: Send

Call `SendMessage` with `to` set to the exact roster name.

- Set `notify_when_idle: true` when the agent's `machine` equals the roster's
  top-level `machine` (where the commander runs). The idle notice is how the
  commander learns that a local worker stopped without reporting.
- For a session on another machine, no delivery notice comes back. A
  successful send means it reached the session, not that the worker accepted
  it. A worker in a different permission mode holds the message for its
  operator's approval.

## Step 5: Record

Append a row to the ledger, creating the file with its header if missing.

```markdown
# Commander ledger

| Id       | Agent | Task                   | Sent             | Status | Updated          | Result |
| -------- | ----- | ---------------------- | ---------------- | ------ | ---------------- | ------ |
| H-0929-1 | Acme  | Release 2.4 to staging | 2026-09-29 10:12 | sent   | 2026-09-29 10:12 |        |
```

Statuses: `queued`, `sent`, `done`, `blocked`, `decision`, `orphaned`,
`cancelled`. When a reply arrives, update `Status`, `Updated` and `Result`
(one line plus links). Remove `done` and `cancelled` rows older than seven
days, because the ledger tracks what is open, and the vault and GitHub keep the
history.

Report to the operator in one line: the id, the agent, and whether it was sent
or queued.
