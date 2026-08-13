# Plugins

Claude Code plugins distributed from this repo as a marketplace. A skill is a
reusable workflow: the procedure and reference knowledge are packaged once, and
you point it at a target that varies per run: a pull request, a logfile, a
path, or a spec.

## Add the Marketplace

```text
/plugin marketplace add lekman/ai-toolkit
/plugin install git@ai-toolkit
/plugin install planner@ai-toolkit
/plugin install obsidian@ai-toolkit
/plugin install wrap@ai-toolkit
```

Then invoke a skill, for example `/git:commit`.

## Plugins

- **git**, [commit](git/skills/commit/SKILL.md) / [pr](git/skills/pr/SKILL.md):
  analyse changes and create grouped conventional commits with QA checks and
  strict hook compliance; open pull requests from the repository's own template,
  falling back to a tracker-agnostic
  [default](git/templates/pull_request_template.md). Ships a `PreToolUse`
  [stack guard](git/hooks/stack-guard.sh) that blocks a second `gh pr create`
  against the default branch while one of your pull requests is still open, and
  redirects to `gh stack`, with a typed `STACK_OK=1` escape for work that is
  genuinely independent. See [git/README.md](git/README.md).
- **planner (goal workflow)**, [goal](planner/skills/goal/SKILL.md) /
  [execute](planner/skills/execute/SKILL.md): agree a Definition of Done as a
  Test Plan with the operator, then execute it autonomously to a validated
  result. The plan document is the contract between the executing agent and a
  separate reviewing identity: one agent's goal is to complete the work, the
  other's is to verify the goal plan was met.
- **obsidian**, [dashboard sync skills](obsidian/README.md) (add, tick, today,
  wrapup, sync-todo, focus): resolve the active client by discovery from the
  working directory and read/write a `Dashboard.md`, without hardcoding any
  client name. Client identities live only in a local, uncommitted config.

- **wrap**, [day](wrap/skills/day/SKILL.md) /
  [session](wrap/skills/session/SKILL.md) /
  [handover](wrap/skills/handover/SKILL.md): close the working day (dashboard
  reconcile, rollover, archive, git prune, day report); close a long session by
  writing a `.tmp/session-handover.md`, with learning recommendations the next
  session judges, injected automatically at session start by the plugin's
  hook; and hand work to an agent that has no context by writing a vault note
  to the [handover contract](wrap/HANDOVER.md): constraints before tasks, each
  task with its verification command, what is already done, and which earlier
  beliefs turned out wrong. See [wrap/README.md](wrap/README.md).
- **planner**, [today](planner/skills/today/SKILL.md): the day's open items
  across all clients from the dashboard, tracker-first (never calendars or a
  retrieval index first), with weekend fall-forward to Monday and clients
  kept visible as "All done" when their day is fully ticked. Supplements the
  plate with live calendars: ICS feeds and, via the
  [calendar package](../packages/calendar/README.md), Office 365 over OAuth:
  meetings, admin-calendar checklists, and todo-style self-events. See
  [planner/README.md](planner/README.md).
- **tone**, [write](tone/skills/write/SKILL.md): the house documentation
  tone for markdown, Word, PDF, and HTML deliverables: plain language, banned
  filler and empty modifiers, UK English, title case headings, and export-safe
  markdown structure. Pairs with the copyable [rule](../rules/tone.md) scoped
  to `**/*.md`. Blog posts stay with the `lekman-blog` skill. See
  [tone/README.md](tone/README.md).
