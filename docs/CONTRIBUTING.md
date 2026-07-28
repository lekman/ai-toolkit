# Contributing

How to work in this repo. Consumer documentation lives in each folder's
`README.md`; anything that assumes you have the repo checked out belongs here or
in a package's own `CONTRIBUTING.md`.

## Where things go

The top level is flat and grouped by how each thing is consumed. [CLAUDE.md](../CLAUDE.md)
is the navigation map; the short version:

| Folder           | For                                                       |
| ---------------- | --------------------------------------------------------- |
| `standards/`     | Base Claude instruction files, dropped into `~/.claude`.  |
| `security/`      | Security settings by level.                               |
| `privacy/`       | Keeping PII, PHI, and financial data away from the model. |
| `observability/` | Seeing what the agent does and being notified.            |
| `practices/`     | Operating models and patterns. Prose, not config.         |
| `docs/`          | Concepts that span more than one practice.                |
| `plugins/`       | Claude Code plugins. Also makes this repo a marketplace.  |
| `packages/`      | Runnable TypeScript: CLIs, MCP servers, base projects.    |

If a change is guidance, it goes in `practices/`. If it is something you install
and run, it goes in `packages/` or `plugins/`. If it explains _why_ across
several of those, it goes in `docs/`.

Every folder carries its own `README.md`. Add one when you add a folder.

## Writing

The repo's own standards apply to its documentation, not only to the
instructions it ships:

- [standards/TONE.md](../standards/TONE.md) — plain language, no empty modifiers
  ("comprehensive", "robust", "seamless"), no filler agreement. Assume the reader
  does not have English as a first language.
- [.claude/rules/markdown.md](../.claude/rules/markdown.md) — every link points
  at a **file**, never a bare directory. `[security](security/)` breaks silently
  when files move; `[security/README.md](security/README.md)` does not.

Say what something costs, not only what it does. A README that lists benefits and
omits the trade is not finished.

## Commits

Conventional commits, enforced by commitlint ([config](../commitlint.config.mjs)).

```text
feat(packages): add @lekman/claude-local for running Claude Code locally
docs(practices): add the local-models practice
refactor(claude-local)!: collapse to a single claude-local command
```

Scope is the folder or package the change lives in. Use `!` and a
`BREAKING CHANGE:` footer when a published interface changes.

Group related work into one commit and unrelated work into separate ones — a
commit that touches a package and rewrites an unrelated practice is two commits.

## Branches and pull requests

Work on a branch, never on `main`. Open a pull request even when working alone:
the PR body is where the reasoning lives once the diff stops explaining itself.

```bash
git checkout -b feat/short-description
# ...
gh pr create --fill
```

State in the PR what you did **not** test. Unverified work described as done is
worse than work described as unverified.

## Linting

[Trunk](https://trunk.io) runs markdownlint, prettier, gitleaks, trufflehog, and
a diff check, with commitlint as an action. Configuration is in
[.trunk/trunk.yaml](../.trunk/trunk.yaml).

```bash
trunk check          # lint the diff
trunk fmt            # format
```

If `trunk` is not installed, formatting still matters: prettier's defaults are
what the repo is checked against.

## Packages

Everything under `packages/` is TypeScript, built with [Bun](https://bun.sh), and
published for Node. Dependencies are bundled into the build so a published CLI
has no runtime dependencies and a cold `npx` installs nothing — Bun is a
build-time tool, never a requirement for users.

That has one consequence worth stating plainly, because it compiles cleanly and
fails at the worst moment: **`src/` may use Node APIs only.** A `Bun.*` call
builds fine, ships fine, and then crashes for every user who does not have Bun.

Each package carries its own `CONTRIBUTING.md` with its layout, its release
process, and whatever is specific to it:

- [packages/claude-local/CONTRIBUTING.md](../packages/claude-local/CONTRIBUTING.md)
  — the `claude-local` CLI: building, adding a model to the catalog, and
  publishing to npm.

### Releasing

Packages publish from a maintainer's machine with browser-based `npm login`, not
a token. npm revoked classic tokens in early 2026 and write-enabled granular
tokens now expire in days, so a long-lived local token is not something you can
have. Release from CI with
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) if you want
provenance attestations, which cannot be produced from a laptop.

## Scope

Anthropic (Claude) only. No other model ecosystems — not as a comparison, not as
a fallback. The one exception is describing something Claude tooling must
interoperate with, such as an OpenAI-shaped local endpoint, where the difference
is the point being made.
