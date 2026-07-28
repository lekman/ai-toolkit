# Packages

Runnable code: CLIs, MCP servers, and base projects. Everything else in this
repo is instructions and config for Claude; this folder is software you install
and run.

Built with Bun, published for Node. Dependencies are bundled into the build, so
a published package installs nothing and runs under plain `npx` on Node 20 or
later. Bun is a build-time tool here, not something users need.

- [claude-local/](claude-local/README.md): `claude-local` — run Claude Code
  against a model on your own machine. Installs the backend on first run, swaps
  models with `--switch`, and passes everything it does not recognise straight
  through to `claude`. The practice behind it is
  [practices/local-models/README.md](../practices/local-models/README.md).
