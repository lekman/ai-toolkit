# Packages

Runnable code: CLIs, MCP servers, and base projects. Everything else in this
repo is instructions and config for Claude; this folder is software you install
and run.

Built with Bun, published for Node. Dependencies are bundled into the build, so
a published package installs nothing and runs under plain `npx` on Node 20 or
later. Bun is a build-time tool here, not something users need.

TBD add table here instead for packages.

TBD add "related information" or something with contributing links instead.

Below: move to above instead.

Building and releasing: [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md), then the
`CONTRIBUTING.md` inside each package.

- [claude-local/](claude-local/README.md): `claude-local` — run Claude Code
  against a model on your own machine. Installs the backend on first run, swaps
  models with `--switch`, and passes everything it does not recognise straight
  through to `claude`. The practice behind it is
  [practices/local-models/README.md](../practices/local-models/README.md).
- [claude-bedrock/](claude-bedrock/README.md): `claude-bedrock` — run one
  Claude Code session on AWS Bedrock without switching your global settings.
  A launcher only; setup stays with Claude Code's own `/setup-bedrock`. The
  practice behind it is [practices/bedrock/README.md](../practices/bedrock/README.md).
- [claude-foundry/](claude-foundry/README.md): `claude-foundry` — the same for
  Claude on Microsoft Foundry (Azure). Foundry has no setup wizard and checks
  nothing before the first request, so this one also validates the
  configuration and the Azure session before it launches, and its `--setup`
  is the missing wizard: it deploys the models through the Azure CLI and writes
  the env file. The practice behind it is
  [practices/foundry/README.md](../practices/foundry/README.md).
- [claude-docker/](claude-docker/README.md): `claude-docker` — run one Claude
  Code task in a container that clones only that task's repo and branch, using
  a dedicated account's key. Permissions are bypassed inside, because the
  boundary replaces the prompt. The concern behind it is
  [security/isolated/README.md](../security/isolated/README.md).
