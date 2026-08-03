# Practices

Patterns and operating models for working with Claude, across projects. Prose,
not config: the _how_ and _why_ of a way of working. Enforcement lives in the
other areas (security, observability, plugins); this folder explains the shape
they add up to.

## Agent Isolation

TBD explain why isolating agents, refer to [www.lekman.com/blog/ai-security-defence-in-depth-for-agents](https://www.lekman.com/blog/ai-security-defence-in-depth-for-agents)

mermaid here: claude-local, claude-foundry, claude-bedrock, [isolated-agent security](../security/isolated/README.md), and claude-docker, links and explanations.


- [local-models/](local-models/README.md): run Claude Code against a model on
  your own machine via LM Studio's Anthropic-compatible endpoint, for work that
  must not leave the laptop. Installed and driven by
  [@lekman/claude-local](../packages/claude-local/README.md).
- [bedrock/](bedrock/README.md): run Claude Code on AWS Bedrock and keep the SSO
  session alive with a `SessionStart` auto-login hook, so a session never fails
  part way through on an expired token.
- [foundry/](foundry/README.md): run Claude Code on Claude in Microsoft Foundry
  (Azure), where there is no setup wizard and nothing checks the configuration
  before the first request — so pinning models and checking the Azure session
  are yours to do. Driven by
  [@lekman/claude-foundry](../packages/claude-foundry/README.md).

## Orchestration

TBD some intro on why

- [planning-handoff.md](planning-handoff.md): plan in Claude Desktop, implement
  in Claude Code on dedicated instances, and connect the two with committed
  day plans and briefs under `docs/handoff/`. The operating model behind the
  [handoff plugin](../plugins/handoff/skills/plan-handoff/SKILL.md).
- [orchestrator-subagent.md](orchestrator-subagent.md): run agents continuously
  by splitting work between a planning orchestrator that never touches code and
  disposable, scoped subagents that do. The operating model behind
  [isolated-agent security](../security/isolated/README.md).
