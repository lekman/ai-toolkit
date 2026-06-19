# Plugins

Claude Code plugins distributed from this repo as a marketplace. A skill is a
reusable workflow: the procedure and reference knowledge are packaged once, and
you point it at a target that varies per run — a pull request, a logfile, a
path, or a spec.

## Add the marketplace

```text
/plugin marketplace add lekman/ai-toolkit
/plugin install git@ai-toolkit
```

Then invoke a skill, for example `/git:commit`.

## Plugins

- **git** — [commit](git/skills/commit/SKILL.md): analyze changes and create
  grouped conventional commits with QA checks and strict hook compliance.
