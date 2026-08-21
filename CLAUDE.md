# ai-toolkit

My practices for working with Claude. The README covers the _why_ (concerns);
this file is the _shape_, for navigation.

Top level is flat and grouped by how each thing is consumed:

- `standards/`: base Claude instruction files; drop into `~/.claude`.
- `security/`: security settings by level (machine, isolated, and later CI…).
- `privacy/`: keep PII / PHI / financial data from reaching the agent or model.
- `practices/`: best practices, patterns, and workflows (guidance, prose).
  Includes `obsidian/`: run an Obsidian vault as an agent-operated
  workspace; `observability/`: see what the agent does and get notified
  (notifications now, progress and access visibility to come); and `graphs/`:
  build a structural graph of a repository, and where to run the analysis
  given that it reads every file and fans out across the repo.
- `docs/`: cross-cutting concepts that span practices (e.g. hard vs soft controls).
- `plugins/`: Claude Code plugins.
- `skills/`: Claude Code skills.
- `rules/`: reusable rule files.
- `packages/`: runnable TypeScript: CLIs, MCP servers, and the Agent SDK on
  AWS Bedrock base project.

The repo also has its own `.claude/` with repo-level hooks, rules, and a
`settings.json` that protect this repo. Each folder carries its own README.
`standards/`, `security/`, `privacy/`, `docs/`, `practices/`,
`plugins/`, and `packages/` exist today (`plugins/` also makes this repo a Claude
Code plugin marketplace); the rest are added as content lands. Packages are
written in TypeScript, built with Bun, and published for Node: dependencies are
bundled so a published CLI runs under plain `npx`. Anthropic (Claude) only, no other ecosystems.
