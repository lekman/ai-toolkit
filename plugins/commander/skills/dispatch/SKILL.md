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
options. Wrap the question in `notify ask` and `notify answered` (see
`/commander:notify`), so it reaches the operator's phone if it waits past the
threshold.

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

## Step 3: Check the Day Plan

The first message a worker gets each day asks it to confirm the day plan. No
task goes to that worker until the operator has agreed the plan, because a
task sent against a stale plan can be done, moot or in the wrong order.

Find today's plan-check row for the agent in the ledger. Its `Id` starts with
`H-<MMDD>-` for today and its `Task` starts with `Day-plan check`. The ledger
is the only state, so a fresh commander reaches the same answer.

- **No plan-check row** → send the plan check first (Step 3a), then record the
  requested task as `queued` with `Result` set to `waits on <plan-check id>`.
- **Plan-check row not `done`** → the operator has not agreed the plan yet.
  Record the task as `queued`, `waits on <plan-check id>`. Do not send it.
- **Plan-check row `done`** → continue to Step 4.

If the operator says to send without the check (an urgent task, say), send it
and write `plan check skipped` in its `Result`. Only the operator can skip it.

### Step 3a: Plan-Check Brief

Take the next id for the plan check and the one after it for the queued task.
The brief is read-only. The worker reports and the operator decides.

```text
Handoff H-0929-1 from Commander: day-plan check before today's work

Goal: an agreed day plan for <client> before any task starts.
Context: first message to you today. Read today's dashboard items for <client>
  with /planner:today. Change nothing and start nothing.
Answer three questions:
  1. Which of today's items are done, moot or wrong?
  2. Is the priority order right? If not, give the order you propose.
  3. Should anything from Tomorrow, Future or Unscheduled come into today?
Constraints: read only. Tasks are held until the operator agrees the plan.
Done when: you have answered all three.

Report back with SendMessage to "Commander". First line:
  H-0929-1 DECISION: <n> changes proposed | no changes
Then one line per proposed change. Do not send transcripts or logs.
```

Record it with `Task` set to `Day-plan check: today's items, order, pull-ins
from later days`. The reply arrives as `decision`. Show it to the operator. A
row that stays in `decision` past the notify threshold is pushed to the
operator's phone by `/commander:nudge` Step 5.

### Step 3b: Release the Queue

When the operator agrees the plan, with or without changes:

1. Apply the agreed changes to the dashboard from this session, as
   `/commander:plan-check` Step 7 describes. Workers do not edit the
   dashboard, because several sessions writing it at once overwrite each
   other.
2. Set the plan-check row to `done`, with the agreed changes in `Result`.
3. Take the agent's rows that `wait on` it, in id order. Check each against
   the agreed plan. Ask the operator about a task that the plan made moot, and
   set it to `cancelled` if they drop it.
4. Send each remaining task through Steps 4 to 6 under its existing id. Start
   the first brief's `Context` with `Day plan agreed and applied: <one line>`,
   so the worker starts from the current dashboard.

## Step 4: Write the Brief

Allocate the next id: `H-<MMDD>-<n>`, where `n` counts today's rows in the
ledger. A queued task keeps the id it was given when it was queued. The first
line of the message is the only part the worker's operator sees without
expanding it, so it carries the id and the task.

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

## Step 5: Send

Call `SendMessage` with `to` set to the exact roster name.

- Set `notify_when_idle: true` when the agent's `machine` equals the roster's
  top-level `machine` (where the commander runs). The idle notice is how the
  commander learns that a local worker stopped without reporting.
- For a session on another machine, no delivery notice comes back. A
  successful send means it reached the session, not that the worker accepted
  it. A worker in a different permission mode holds the message for its
  operator's approval.

## Step 6: Record

Append a row to the ledger, creating the file with its header if missing. A
queued task that is now sent updates its own row (`Sent`, `Status`, `Updated`)
instead of adding one.

```markdown
# Commander ledger

| Id       | Agent | Task                   | Sent             | Status | Updated          | Result |
| -------- | ----- | ---------------------- | ---------------- | ------ | ---------------- | ------ |
| H-0929-1 | Acme  | Release 2.4 to staging | 2026-09-29 10:12 | sent   | 2026-09-29 10:12 |        |
```

Statuses: `queued`, `sent`, `done`, `blocked`, `decision`, `orphaned`,
`cancelled`. A `decision` row waits on the operator. `/commander:nudge` pushes
it to their phone once its `Updated` time is past the notify threshold, so keep
`Updated` as the time the decision arrived, and put the worker's one-line
question in `Result`. When a reply arrives, update `Status`, `Updated` and `Result`
(one line plus links). Remove `done` and `cancelled` rows older than seven
days, because the ledger tracks what is open, and the vault and GitHub keep the
history.

Report to the operator in one line: the id, the agent, and whether it was sent
or queued.
