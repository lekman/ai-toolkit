# Wrap

Two closing rituals, at two timescales:

- **`/wrap:day`** — end of the working day, once per client. Reconciles the
  Obsidian dashboard against what actually happened (`.tmp/TODO.md`, PRs
  authored/merged/reviewed today), rolls open items to the next working day,
  archives the finished day to `Archive.md`, prunes merged-and-deleted git
  branches and stale worktrees, and reports: goal met?, achievements,
  tomorrow's intent and tasks.
- **`/wrap:session`** — end of a long session, instead of `/compact`. Analyses
  the conversation for learnings and writes `.tmp/session-handover.md` with the
  branch, a short summary, carry-overs, a suggested next work item, and
  improvement recommendations. It deliberately writes no rules or skills — each
  learning gets a recommended disposition (global rule / project rule / skill /
  ticket / discard) and the **next** session makes the judgement call.

## Handover pickup

The plugin ships a `SessionStart` hook ([hooks/hooks.json](hooks/hooks.json))
that injects `.tmp/session-handover.md` into context when a new session starts
in that repo. The file ends with a "Next session" contract telling the fresh
agent to pick up carry-overs and judge the recommendations first. No global
settings edit needed — installing the plugin wires it.

Pickup is one-shot: right after injecting the file, the hook renames it to
`.tmp/session-handover-<timestamp>.md`. A handover is therefore processed
exactly once, but never lost — if the session that consumed it fails, rename
the archived copy back to `session-handover.md` and it replays on the next
start.

Keep `.tmp/` gitignored: the handover is per-machine working state, not code.

## Client detection

`/wrap:day` resolves the active client the same way the obsidian plugin does:
the longest matching repo-path prefix in `~/.claude/obsidian.json` (`clients`
map). Working for several clients in one day means running `/wrap:day` once
from each client's repo; the finished day is archived only when no client has
open items left under it. See the privacy model in
[the obsidian plugin README](../obsidian/README.md) — client names live only in
local config, never in these skills.

## Skills

- **day** — [skills/day/SKILL.md](skills/day/SKILL.md)
- **session** — [skills/session/SKILL.md](skills/session/SKILL.md)
