---
name: scale
description: Recommend opening additional worker sessions when queued work could run in parallel, with the exact start command for each. Recommends only; never starts a session. Use when the user says "/commander:scale", "should I open another session", "can this run in parallel", or when roll-call shows a queue behind one busy agent.
user-invocable: true
---

# Scale

Decide whether a queue of work would finish sooner with another session, and
if so, say exactly which session to open. The operator starts it; this skill
never does.

## Step 1: Gather the Queue

- Call `ListAgents` for live state.
- Read the ledger for rows in `queued` or `sent` per agent.
- Read today's open dashboard items for the clients in the roster (the same
  source `/planner:today` uses) that have no ledger row yet.

## Step 2: Find Parallel Work

Another session helps only when all of these hold for a candidate task:

1. **The owner is busy** with a different handoff, or has two or more open.
2. **The task is independent.** It is in a different repository, or it touches
   different files and needs no result from the running task.
3. **It is not serial.** Tasks in the agent's `serial` list (deployments,
   releases) never run in parallel with each other.
4. **It is worth a session.** A task under about ten minutes waits in the
   queue; the start-up and briefing cost more than the wait.

If no task passes, say "No parallel work worth a new session" and stop.

## Step 3: Recommend

For each task that passes, give a Do item with the command and the name. Use a
worktree when the new session shares a repository with a running session, so
the two do not edit one checkout.

```bash
cd ~/Repo/acme && claude --worktree acme-2 --remote-control "Acme 2"
```

- Name extra sessions `<Owner> <n>`, so roll-call can group them with their
  owner.
- On the server, prefer a same-machine session: the commander then gets an
  idle notice when it finishes.
- A task that only needs a result and no operator interaction can instead run
  as a background subagent of the commander (`Agent` with
  `isolation: "worktree"`). Say so when it applies; it avoids a new session but
  puts the result into the commander's context.

Present the options with `AskUserQuestion` when there is more than one
candidate or the trade-off is not clear, recommendation first. After the
operator opens a session, add it to the roster only if it will be reused;
a one-off session stays out of the roster and is closed when its handoff is
done.
