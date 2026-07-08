# Plugins

Claude Code plugins distributed from this repo as a marketplace. A skill is a
reusable workflow: the procedure and reference knowledge are packaged once, and
you point it at a target that varies per run — a pull request, a logfile, a
path, or a spec.

## Add the marketplace

```text
/plugin marketplace add lekman/ai-toolkit
/plugin install git@ai-toolkit
/plugin install goal@ai-toolkit
/plugin install obsidian@ai-toolkit
/plugin install handoff@ai-toolkit
```

Then invoke a skill, for example `/git:commit`.

## Plugins

- **git** — [commit](git/skills/commit/SKILL.md): analyze changes and create
  grouped conventional commits with QA checks and strict hook compliance.
- **goal** — [plan](goal/skills/plan/SKILL.md) /
  [execute](goal/skills/execute/SKILL.md): agree a Definition of Done as a
  Test Plan with the operator, then execute it autonomously to a validated
  result. The plan document is the contract between the executing agent and a
  separate reviewing identity: one agent's goal is to complete the work, the
  other's is to verify the goal plan was met.
- **obsidian** — [dashboard sync skills](obsidian/README.md) (add, tick, today,
  wrapup, sync-todo, focus): resolve the active client by discovery from the
  working directory and read/write a `Dashboard.md`, without hardcoding any
  client name. Client identities live only in a local, uncommitted config.
- **handoff** — [plan-handoff](handoff/skills/plan-handoff/SKILL.md): package
  planning and architecture output into a committed dispatch folder
  (`docs/handoff/`): a day plan plus self-contained per-ticket briefs that a
  fresh Claude Code session can execute without the planning conversation. The
  operating model is described in
  [practices/planning-handoff.md](../practices/planning-handoff.md).
