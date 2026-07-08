# Practices

Patterns and operating models for working with Claude, across projects. Prose,
not config: the _how_ and _why_ of a way of working. Enforcement lives in the
other areas (security, observability, plugins); this folder explains the shape
they add up to.

- [planning-handoff.md](planning-handoff.md): plan in Claude Desktop, implement
  in Claude Code on dedicated instances, and connect the two with committed
  day plans and briefs under `docs/handoff/`. The operating model behind the
  [handoff plugin](../plugins/handoff/skills/plan-handoff/SKILL.md).
- [orchestrator-subagent.md](orchestrator-subagent.md): run agents continuously
  by splitting work between a planning orchestrator that never touches code and
  disposable, scoped subagents that do. The operating model behind
  [isolated-agent security](../security/isolated/README.md).
- [bedrock/](bedrock/README.md): run Claude Code on AWS Bedrock and keep the SSO
  session alive with a `SessionStart` auto-login hook, so a session never fails
  part way through on an expired token.
