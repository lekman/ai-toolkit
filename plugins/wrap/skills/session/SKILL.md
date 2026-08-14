---
name: session
description: End a long session instead of compacting — analyse the conversation for learnings worth codifying, then write .tmp/session-handover.md so the next session starts with full context and judges what to codify. Use only when the user asks for it — "/wrap:session", "wrap this session", "prepare the handover before I start a new session". Never start it on your own initiative, including when context is running low.
user-invocable: true
allowed-tools: Read, Grep, Glob, Write, Bash, AskUserQuestion
---

# Wrap the Session

Run at the end of a long session, instead of `/compact`. Two jobs: extract
learnings as **recommendations** (not rules; the next session judges them),
and write a handover file the next session picks up automatically via the
plugin's SessionStart hook.

This session writes **no rules, no skills, no tickets**. It briefs; the next
agent decides.

## Scope: Which Handover You Need

`.tmp/session-handover.md` is repo-local, machine-local, and one-shot. It
carries **learnings and carry-overs to the next session in this repo, on this
machine**.

If the work itself moves (to an agent on another machine, a containerised or
hosted agent, or simply to another day), that needs a **vault handover** as
well: `/wrap:handover`, written to the contract in
[HANDOVER.md](../../HANDOVER.md). The two do not overlap. Decide at the start of
this skill, because it changes what belongs in Carry-overs: if a vault handover
is being written, Carry-overs states that and links it rather than duplicating
the task detail.

## Step 1: Analyse the Conversation for Learnings

Review the whole conversation for:

- Corrections the user made ("no, do it this way", "use X instead of Y")
- Repeated mistakes that needed intervention
- Conventions stated or enforced inconsistently
- The same manual work done more than once
- External blockers that slowed the work

Discard noise: one-off decisions, standard framework behaviour, corrections
caused by missing context, style preferences not consistently enforced.

## Step 2: Assign Each Learning a Disposition

For each surviving learning, recommend one disposition and say why:

| Signal                                                  | Disposition                                                |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| Pattern useful to the whole team (e.g. an auth pattern) | **Global rule**: standards repo / `~/.claude`, not project |
| Pattern personal to how this user works                 | **Global rule (personal)**: user-level, not project        |
| AI consistently gets this repo wrong, affects everyone  | **Project rule**: `.claude/rules/`                         |
| Same multi-step work repeated across sessions           | **Skill**: ideally with an embedded script for consistency |
| External issue blocking quality or speed                | **Ticket**: raise with a link to the evidence              |
| Real learning, but not worth codifying                  | **Discard**: say so, with one line of reasoning            |

Each recommendation needs: the behaviour, the signal from this session
(quote or reference), the proposed disposition, and one concrete example.

## Step 3: Write the Handover File

Write `.tmp/session-handover.md` (create `.tmp/` if needed; verify `.tmp/` is
gitignored and warn if not). The file is one-shot: the SessionStart hook
injects it into the next session and immediately renames it to
`session-handover-<timestamp>.md`, so a fresh wrap normally finds no file to
overwrite; archived copies stay behind for manual replay. Use exactly this
template:

```markdown
# Session handover

- **Branch:** <current git branch>
- **Written:** <date and time, e.g. 2026-08-05 17:40>

## Summary

<2–4 sentences: what this session did. No process narration.>

## Carry-overs

<What was not achieved and needs care next session — direct tasks, underlying
issues, or things to discuss. "None" if clean. Mark each claim verified (with
its date) or unverified; never state an inference as an observation. If a vault
handover covers the work, link it here instead of restating its tasks.>

## Suggested next work item

<One concrete suggestion, with a reference link (PR, issue, ticket, file) if
applicable.>

## Improvement recommendations

<One subsection per learning from Step 2:>

### <short name>

- **Signal:** <what happened this session>
- **Recommendation:** <global rule | project rule | skill | ticket | discard>
- **Why:** <one or two lines>
- **Example:** <concrete good/bad example if it is a rule candidate>

## Next session

You are the next agent. Start by:

1. Confirming the branch and picking up the carry-overs.
2. Judging each improvement recommendation above: codify it (rule at the
   recommended level, or a skill), turn it into a ticket, or discard it with a
   stated reason. This is your call — the previous session deliberately did not
   decide.
3. Then proceed to the suggested next work item unless the user redirects.
```

## Step 4: Close Out

Report to the user in two or three lines: handover written, how many
recommendations it carries, and that they can now start a fresh session: the
SessionStart hook injects the handover automatically and archives it as
`session-handover-<timestamp>.md` so it is processed exactly once.

If `.tmp/` has archived handovers older than 30 days, mention they can be
deleted (do not delete them unasked).

If the dashboard likely has completions to tick, suggest `/obsidian:wrapup`
(do not run it unasked).

If the work is passing to another agent or machine and no vault handover exists
yet, say so and suggest `/wrap:handover`: a `.tmp/` file is unreachable from
there.

## Constraints

- Never write to `.claude/rules/`, skills, or memory from this skill: defer
  every codification decision to the next session.
- Write a fresh handover file; never append to or edit an archived
  `session-handover-<timestamp>.md`.
- Keep the summary and carry-overs short enough that injecting the file at
  session start costs little context.
