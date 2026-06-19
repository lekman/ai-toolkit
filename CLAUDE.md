# ai-toolkit

My practices for working with Claude. The README covers the *why* (concerns);
this file is the *shape*, for navigation.

Top level is flat and grouped by how each thing is consumed:

- `standards/` — base Claude instruction files; drop into `~/.claude`.
- `security/` — security settings by level (machine, isolated, and later CI…).
- `privacy/` — keep PII / PHI / financial data from reaching the agent or model.
- `practices/` — best practices, patterns, and workflows (guidance, prose).
- `docs/` — cross-cutting concepts that span practices (e.g. hard vs soft controls).
- `plugins/` — Claude Code plugins.
- `skills/` — Claude Code skills.
- `rules/` — reusable rule files.
- `packages/` — runnable TypeScript: CLIs, MCP servers, and the Agent SDK on
  AWS Bedrock base project.

The repo also has its own `.claude/` — repo-level hooks, rules, and a
`settings.json` that protect this repo. Each folder carries its own README.
`standards/`, `security/`, `privacy/`, and `docs/` exist today; the rest are
added as content lands. Anthropic (Claude) only — no other ecosystems.
