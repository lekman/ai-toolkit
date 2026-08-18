# Wrap

Three closing rituals, at three scopes: the day, the session, and the work
itself when it moves to someone else.

- **`/wrap:day`**: end of the working day, once per client. Reconciles the
  Obsidian dashboard against what actually happened (`.tmp/TODO.md`, PRs
  authored/merged/reviewed today), rolls open items to the next working day,
  archives the finished day into the month work log
  (`Archive/Work Logs/<year>/<Month>.md`, newest day first), prunes
  merged-and-deleted git branches and stale worktrees, and reports: goal met?,
  achievements, tomorrow's intent and tasks.
- **`/wrap:session`**: end of a long session, instead of `/compact`. Analyses
  the conversation for learnings and writes `.tmp/session-handover.md` with the
  branch, a short summary, carry-overs, a suggested next work item, and
  improvement recommendations. It deliberately writes no rules or skills: each
  learning gets a recommended disposition (global rule / project rule / skill /
  ticket / discard) and the **next** session makes the judgement call.
- **`/wrap:handover`**: the work moves to an agent that was not in the
  conversation: a session on another machine, a fresh run, a containerised
  agent, or you after a gap. Writes one vault note to the contract in
  [HANDOVER.md](HANDOVER.md) and links it from today's dashboard.

## The Handover Contract

[HANDOVER.md](HANDOVER.md) is the single definition of what a handover contains,
and all three skills follow it. The shape exists because a task list says _what_
is left and never says **what will bite you**:

- constraints **before** tasks: freezes, what deploys where, and the traps that
  make a wrong answer look right (a green check that proves nothing, stale state
  in a module you never touched, a pipeline that applies silently to nothing);
- every task with its verification command **and** what a correct result looks
  like, plus a second command proving the change is live rather than merely
  registered;
- what is already done, so nobody redoes it, and which earlier beliefs turned
  out **wrong**, so nobody re-derives them;
- anything irreversible gated as _needs an operator decision_;
- open findings kept separate from tasks, marked _do not fix unilaterally_;
- every claim marked verified-and-when, or explicitly unverified.

### Where Handovers Live

The vault, and only the vault:
`Clients/<Client>/Handover — <topic>, <Day> <D> <Mon> <YYYY>.md`, linked from the
dashboard's current day as a `> [!abstract]` callout under that client's
heading. Handover notes are indexed for retrieval, so an agent with vault access
finds one by searching the topic. No repo copy: two copies drift, and the vault
one is what gets searched. An agent without vault access gets the text pasted;
containerised agents can instead mount the vault (see the
[claude-docker README](../../packages/claude-docker/README.md)).

## Session Handover Pickup

The plugin ships a `SessionStart` hook ([hooks/hooks.json](hooks/hooks.json))
that injects `.tmp/session-handover.md` into context when a new session starts
in that repo. The file ends with a "Next session" contract telling the fresh
agent to pick up carry-overs and judge the recommendations first. No global
settings edit needed: installing the plugin wires it.

Pickup is one-shot: right after injecting the file, the hook renames it to
`.tmp/session-handover-<timestamp>.md`. A handover is therefore processed
exactly once, but never lost: if the session that consumed it fails, rename
the archived copy back to `session-handover.md` and it replays on the next
start.

Keep `.tmp/` gitignored: the handover is per-machine working state, not code.

## Client Detection

`/wrap:day` resolves the active client the same way the obsidian plugin does:
the longest matching repo-path prefix in `~/.claude/obsidian.json` (`clients`
map). Working for several clients in one day means running `/wrap:day` once
from each client's repo; the finished day is archived only when no client has
open items left under it. See the privacy model in
[the obsidian plugin README](../obsidian/README.md): client names live only in
local config, never in these skills.

## Skills

- **day**: [skills/day/SKILL.md](skills/day/SKILL.md)
- **session**: [skills/session/SKILL.md](skills/session/SKILL.md)
- **handover**: [skills/handover/SKILL.md](skills/handover/SKILL.md)
