# ai-toolkit

My practices for working with Claude. The README covers the *why* (concerns);
this file is the *shape*, for navigation.

Top level is flat and grouped by how each thing is consumed:

- `standards/` — base Claude instruction files; drop into `~/.claude`.
- `security/` — security settings by level (machine, and later repo, CI…).
- `practices/` — best practices, patterns, and workflows (guidance, prose).
- `plugins/` — Claude Code plugins.
- `skills/` — Claude Code skills.
- `rules/` — reusable rule files.
- `packages/` — runnable TypeScript: CLIs, MCP servers, and the Agent SDK on
  AWS Bedrock base project.

Each folder carries its own README. `standards/` and `security/` exist today;
the rest are added as content lands. Anthropic (Claude) only — no other
ecosystems.
