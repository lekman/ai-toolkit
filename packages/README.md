# Packages

Runnable code: CLIs, MCP servers, and base projects. Everything else in this
repo is instructions and config for Claude; this folder is software you install
and run.

Built with Bun, published for Node. Dependencies are bundled into the build, so
a published package installs nothing and runs under plain `npx` on Node 20 or
later. Bun is a build-time tool here, not something users need.

- [claude-local/](claude-local/README.md): `setup-claude-local` and
  `switch-claude-local` — install a local model backend on Apple Silicon and
  swap which model Claude Code talks to. The practice behind it is
  [practices/local-models/README.md](../practices/local-models/README.md).
