# Commander

Run one long-lived Claude Code session as a commander. It plans the day with
`/planner:today`, hands work to other named sessions, and tracks what they
are doing. The commander does not do the work itself, so its context stays
small enough to live for days.

## How It Works

Claude Code sessions on one account can message each other. `ListAgents`
lists the live sessions by name; `SendMessage` delivers to a name. A session's
name is its address, so the roster, the session names and the handoff
messages must all use the same exact names.

| Where the worker runs                | Reachable     | Commander learns it finished                            |
| ------------------------------------ | ------------- | ------------------------------------------------------- |
| Same machine as the commander        | Yes           | Idle notice (`notify_when_idle`) and the worker's reply |
| Another machine, with Remote Control | Yes           | Only the worker's reply                                 |
| Cloud session                        | Receives only | Cannot reply today; read its transcript                 |

A worker in a different permission mode from the commander holds incoming
messages for its operator's approval. Run workers in the mode you want them to
act in without you.

## Skills

- [roll-call](skills/roll-call/SKILL.md): who is up, busy or missing against
  the roster, and which handoffs are still open.
- [dispatch](skills/dispatch/SKILL.md): send one task to its owner as a
  self-contained brief with an id and a reply contract, and record it in the
  ledger. The first dispatch to a worker each day sends a day-plan check
  instead, and holds the task until the operator agrees the plan.
- [plan-check](skills/plan-check/SKILL.md): send the day-plan check to every
  client on today's dashboard in one command. A later run reviews the replies,
  asks the operator to agree each plan, applies the agreed changes and
  releases the waiting tasks.
- [nudge](skills/nudge/SKILL.md): find roster workers idle for 10 minutes or
  more with work still open, and ask for a status or tell them to run
  `/planner:next`. Runs on a loop, with a back-off.
- [notify](skills/notify/SKILL.md): push to the operator's phone through
  Pushover, once per state, and push a question the operator has not answered
  even while the commander session is blocked on it.
- [scale](skills/scale/SKILL.md): recommend another session, with its start
  command, when queued work could run in parallel. It never starts one.

The [commander agent](agents/commander.md) sets the session's role: plan,
delegate, watch, and do not do the work.

## Setup

1. Install the plugin: `/plugin install commander@ai-toolkit`.
2. Copy [roster.example.json](roster.example.json) to
   `~/.claude/commander.json` and edit the agents. The roster stays out of the
   repository because it names clients.
3. Start the commander:

   ```bash
   claude --agent commander:commander --name Commander
   ```

   To keep an existing conversation as the commander instead, give it the
   name `Commander` with `/rename` and resume it with `claude --resume`.

4. Start each worker with the name from the roster:

   ```bash
   cd ~/Repo/acme && claude --remote-control "Acme"
   ```

## Daily Routine

The commander session runs these, in this order:

```text
/planner:today              # the day's plan from the dashboard
/commander:plan-check       # send plan checks; run again to review replies
/loop 10m /commander:nudge  # every 10 minutes: nudge idle workers that still have work
```

### Reaching the Operator Away From the Terminal

The commander pushes to the operator's phone through
[`/commander:notify`](skills/notify/SKILL.md) when something waits on them for
the roster's `notify.threshold_minutes` (default 30):

- a worker waiting for approval (`requires_action`), stuck after two nudges,
  or silent on a handoff after its last nudge;
- a `decision` row in the ledger;
- a question the commander asked with `AskUserQuestion`.

A question needs its own mechanism. While `AskUserQuestion` is open the
commander session is blocked and no loop tick fires, so the nudge loop cannot
see it. The commander therefore starts a detached timer, an operating-system
process outside the session, before it asks, and removes the question from
`pending.json` when the answer arrives. A timer that fires on an answered
question does nothing. The nudge loop pushes any question still pending past
the threshold as a backstop, for a timer lost to a restart.

The commander session needs `PUSHOVER_APP_TOKEN` and `PUSHOVER_USER_KEY` in
its environment. Quiet hours are off unless the roster sets them.

### The Nudge Loop

Each tick of the loop runs `/commander:nudge` once. It checks which roster
workers are idle, busy or waiting on you. A worker that has been idle for 10
minutes or more while it still has work gets one nudge. The nudge asks for a
status on an unanswered handoff, or tells the worker to run `/planner:next`
when it has agreed dashboard work and nothing open. A tick with nothing to do
prints `No nudges`.

- **Why 10 minutes.** `ListAgents` says whether a worker is idle now, not for
  how long. The skill records when it first saw a worker idle, so idle time is
  known only to within one interval. A nudge therefore lands 10 to 20 minutes
  after a worker stops. The scheduler delays each fire by an offset
  ([Jitter](https://code.claude.com/docs/en/scheduled-tasks#jitter)), but the
  offset comes from the task ID and is the same on every fire, so ticks stay
  10 minutes apart. A shorter interval nudges sooner but costs a tick in the
  commander's context each time.
- **Only while the session is open.** The loop fires between turns, waits
  while the commander is busy, and stops when the session exits. The docs say
  `claude --resume` or `--continue` restores it unless its seven days have
  passed
  ([Limitations](https://code.claude.com/docs/en/scheduled-tasks#limitations)),
  but the `CronCreate` tool in some versions describes its jobs as
  session-only. After a resume, check with `CronList` and start the loop again
  if it is missing. A fresh conversation never has it. A recurring loop also
  expires after seven days, so start it again at least once a week.
- **Stopping it.** Ask the commander to cancel the nudge loop, or list the
  scheduled tasks with `CronList` and remove it with `CronDelete <id>`. `Esc`
  does not stop a loop with a fixed interval; it only stops a loop that picks
  its own interval
  ([Stop a loop](https://code.claude.com/docs/en/scheduled-tasks#stop-a-loop)).

## Day-Plan Check

The first message to a worker each day asks it to check the day plan before
any work starts. The worker reads its dashboard items and answers three
questions:

1. Which of today's items are done, moot or wrong?
2. Is the priority order right?
3. Should anything from Tomorrow, Future or Unscheduled come into today?

It replies with `DECISION`, and the operator agrees the plan. Until then, the
tasks for that worker wait in the ledger as `queued`, each marked
`waits on <plan-check id>`. After the operator agrees, the commander applies
the agreed changes to the dashboard itself, then sends the tasks in id order.

The ledger is the only record of whether today's check happened, so a fresh
commander asks once, not twice.

## Reply Contract

Each handoff has an id such as `H-0929-1`. The worker replies to `Commander`
with a first line of `H-0929-1 DONE | BLOCKED | DECISION: <one line>`, then
links. No transcripts, because every reply lands in the commander's context.

## Files

- `~/.claude/commander.json`: the roster. Who exists, where they run, what
  they own, and which work is serial.
- `~/.claude/commander/ledger.md`: open handoffs. The commander reads it
  instead of its own memory, so a fresh commander can pick up from it.
- `~/.claude/commander/notify.json`, `pending.json` and `notify.log`: when each
  push key last sent, the questions waiting on the operator, and a log of
  pushes. No credentials.
- `~/.claude/commander/idle.json`: when `/commander:nudge` first saw each
  worker idle, and when it last nudged it. Safe to delete; the next tick
  starts again.
