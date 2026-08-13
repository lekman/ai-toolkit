# Packages

Runnable code: CLIs, MCP servers, editor extensions, and base projects.
Everything else in this repo is instructions and config for Claude; this folder
is software you install and run.

Built with Bun, published for Node. Dependencies are bundled into the build, so
a published package installs nothing and runs under plain `npx` on Node 20 or
later. Bun is a build-time tool here, not something users need.

| Package                                     | What it does                                                                                                                                                                                                                                                                       | Practice                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [claude-local/](claude-local/README.md)     | Runs Claude Code against a model on your own machine. Installs the backend on first run, swaps models with `--switch`, and passes anything it does not recognise through to `claude`.                                                                                              | [local-models](../practices/local-models/README.md)             |
| [claude-bedrock/](claude-bedrock/README.md) | Runs one session on AWS Bedrock without switching your global settings. A launcher only: setup stays with Claude Code's own `/setup-bedrock`.                                                                                                                                     | [bedrock](../practices/bedrock/README.md)                       |
| [claude-foundry/](claude-foundry/README.md) | The same for Microsoft Foundry, which has no setup wizard and checks nothing before the first request. So it also validates the configuration and the Azure session, and its `--setup` is the missing wizard: it deploys the models through the Azure CLI and writes the env file. | [foundry](../practices/foundry/README.md)                       |
| [claude-docker/](claude-docker/README.md)   | Runs one task in a container that clones only that task's repo and branch, with a dedicated account's key. Permissions are bypassed inside, because the boundary replaces the prompt.                                                                                              | [isolated-container](../practices/isolated-container/README.md) |
| [vscode-planner/](vscode-planner/README.md) | A VS Code sidebar showing today's and tomorrow's tasks from the Obsidian dashboard, filtered to the client that owns the repository you have open. Read-only.                                                                                                                      | [planner](../plugins/planner/README.md)                         |

Each package pairs with a practice: the package is the runnable half, the
practice is the reasoning. Read the practice first if you are deciding whether
you want the thing at all.

## Related

- [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md): repo-wide conventions,
  tooling, linting, and how releases work.
- Per-package maintainer notes, for anyone changing one of these:
  [claude-local](claude-local/CONTRIBUTING.md),
  [claude-bedrock](claude-bedrock/CONTRIBUTING.md),
  [claude-foundry](claude-foundry/CONTRIBUTING.md),
  [claude-docker](claude-docker/CONTRIBUTING.md).
- [practices/README.md](../practices/README.md): how these fit together, and
  why "where inference runs" and "what the agent can reach" are separate
  questions.
