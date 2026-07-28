# Contributing to @lekman/claude-bedrock

Maintainer notes for this package. Repo-wide conventions are in
[docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md); read that first.

Consumer documentation is in [README.md](README.md) and stays that way.

## Layout

| Path                | What it is                                                     |
| ------------------- | -------------------------------------------------------------- |
| `src/cli.ts`        | The only entrypoint. Argument parsing, env resolution, launch. |
| `src/lib/config.ts` | Where the Bedrock environment comes from, and the env parser.  |
| `src/lib/aws.ts`    | Session validity and SSO login. Node APIs only.                |
| `scripts/`          | Build and release. Not published.                              |

## Develop

```bash
bun install
bun run check      # typecheck, then build
bun src/cli.ts     # run from source
```

Same two rules as every package here: **Node APIs only in `src/`** (Bun builds
this but never runs it for a user), and **dependencies stay in
`devDependencies`** (the build bundles them, so the published package installs
nothing).

## Keep the scope thin

This package deliberately does **not** discover profiles, pick a region, or
enumerate available models. Claude Code's `/setup-bedrock` does all of that, and
it knows Claude Code's own model-fallback rules — a reimplementation here would
drift as Bedrock support changes upstream.

If a change would duplicate the wizard, the answer is almost always to point at
the wizard instead. The one job this package owns is handing a Bedrock
environment to a single child process so `claude` and `claude-bedrock` can run
side by side.

## Env file parsing

`parseEnvFile` reads a shell-style file; it does **not** execute one. Command
substitution, variable expansion, and multi-line values are unsupported by
design — an env file that needs them is doing too much, and executing a file
found by walking the working directory is a code-execution path we do not want.

If you extend it, keep that boundary.

## Release

```bash
bun run release --dry-run
bun run release
```

Same script and the same rules as
[claude-local](../claude-local/CONTRIBUTING.md#release): refuses uncommitted
work, verifies the built CLI still runs under plain Node, browser-based `npm
login`, and tags `claude-bedrock-v<version>`.

Bump the version in `package.json` **and** the `VERSION` constant in
[src/cli.ts](src/cli.ts).

## Testing by hand

There is no test suite. Before a release:

1. `node dist/cli.js --help` under plain Node — the release script does this.
2. `claude-bedrock --status` in a directory with no config — must explain how to
   set up, not crash.
3. `claude-bedrock --status` with a `.claude/bedrock.env` present — must report
   the repo-local file as the source, and report session validity.
4. `claude-bedrock --no-login` with an expired session — must fail with the
   `aws sso login` command rather than opening a browser.

Never commit a real account ID, inference profile ARN, or AWS profile name in
test fixtures or docs — see the repo-wide rule on client identifiers.
