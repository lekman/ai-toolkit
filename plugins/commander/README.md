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
  ledger.
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

## Files

- `~/.claude/commander.json`: the roster. Who exists, where they run, what
  they own, and which work is serial.
- `~/.claude/commander/ledger.md`: open handoffs. The commander reads it
  instead of its own memory, so a fresh commander can pick up from it.

## Reply Contract

Each handoff has an id such as `H-0929-1`. The worker replies to `Commander`
with a first line of `H-0929-1 DONE | BLOCKED | DECISION: <one line>`, then
links. No transcripts, because every reply lands in the commander's context.
