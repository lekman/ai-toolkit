# ai-toolkit

My practices, tools, and workflows for working with Claude. Not an authority —
just what works for me. Anthropic (Claude) only.

New here? Do the two **Start here** items first. They are low-effort, safe, and
high-value; everything else is opt-in by need.

## Start here — the basics

- **[Standards](standards/README.md)** — make Claude behave consistently across
  every project. Drop a few instruction files into `~/.claude`.
- **[Machine security](security/machine/README.md)** — stop the agent reading or
  clobbering secrets on the machine it runs on.

## Build on it

- **[Privacy](privacy/README.md)** — keep PII, PHI, and financial data away from
  the agent and the model.
- **[Observability](observability/README.md)** — see what the agent is doing and
  get notified when it needs you (remote control, Pushover, local sound).
- **[Isolated-agent security](security/isolated/README.md)** — guard rails for a
  remote or Docker agent, where the machine is disposable but the repo is not.
- **[Skills](plugins/README.md)** — reusable workflows for common tasks (commit,
  and more to come). The procedure and reference knowledge are packaged once;
  you point them at a target that varies per run — a pull request, a logfile, a
  path, a spec. Installed by adding this repo as a plugin marketplace.

## Build with it (advanced)

- **Packages** — runnable TypeScript: CLIs, MCP servers, and the Agent SDK on
  AWS Bedrock base project. *Added as content lands.*

## Why it's shaped this way

- [docs/principles.md](docs/principles.md) — the concerns behind the practices.
- [docs/controls.md](docs/controls.md) — soft vs hard vs boundary controls, and
  why an agent may edit some things but not others.
