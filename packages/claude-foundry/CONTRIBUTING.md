# Contributing to @lekman/claude-foundry

Maintainer notes for this package. Repo-wide conventions are in
[docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md); read that first.

Consumer documentation is in [README.md](README.md) and stays that way.

## Layout

| Path                | What it is                                                    |
| ------------------- | ------------------------------------------------------------- |
| `src/cli.ts`        | The only entrypoint. Argument parsing, validation, launch.    |
| `src/lib/config.ts` | Where the Foundry environment comes from, and the env parser. |
| `src/lib/azure.ts`  | Credential mode, session validity, login. Node APIs only.     |

Build and release scripts are shared by every package and live at the repo root
in [scripts/build.ts](../../scripts/build.ts) and
[scripts/release.ts](../../scripts/release.ts).

## Develop

```bash
bun install        # at the repo root — one lockfile for all packages
bun run check      # typecheck, then build
bun src/cli.ts     # run from source
```

Same two rules as every package here: **Node APIs only in `src/`** (Bun builds
this but never runs it for a user), and **dependencies stay in
`devDependencies`** (the build bundles them, so the published package installs
nothing).

## Scope: wider than claude-bedrock, on purpose

[claude-bedrock](../claude-bedrock/CONTRIBUTING.md#keep-the-scope-thin) refuses
to validate anything, because `/setup-bedrock` already does and a second
implementation would drift. Foundry has no wizard, so that argument does not
apply and this package does check its configuration.

The boundary is still narrow. Checks here must be **local and free**: reading a
variable, matching a placeholder, noticing two mutually exclusive settings.
Nothing that calls the Azure control plane to enumerate resources or
deployments, and nothing that reimplements Claude Code's model-fallback rules —
that is upstream behaviour and would drift the same way.

If Anthropic ships a Foundry setup wizard, most of `assertUsable` should be
deleted in favour of pointing at it.

## Do not steal the shared variables

`ANTHROPIC_DEFAULT_*_MODEL` and `ENABLE_PROMPT_CACHING_1H` are not Foundry's.
Bedrock pins models through the same names, so seeing them in `settings.json`
says nothing about which backend they belong to. `migrateFromSettings` moves
them only when a variable from `FOUNDRY_ONLY` sits beside them. Keep that guard
on any variable this package does not exclusively own.

## Env file parsing

`parseEnvFile` reads a shell-style file; it does **not** execute one. Command
substitution, variable expansion, and multi-line values are unsupported by
design — an env file that needs them is doing too much, and executing a file
found by walking the working directory is a code-execution path we do not want.

If you extend it, keep that boundary.

## Secrets

`ANTHROPIC_FOUNDRY_API_KEY` and `ANTHROPIC_FOUNDRY_AUTH_TOKEN` are in `SECRETS`,
not `REPORTED`. They are handed to the child process and never printed. Any new
credential variable goes in `SECRETS` — `--status` output ends up in issues and
screen shares.

## Release

```bash
bun run release --dry-run   # from the repo root
bun run release
```

One shared script for every package: it compares each workspace package's local
version with the npm registry and publishes only the ones that are ahead. Same
rules as [claude-local](../claude-local/CONTRIBUTING.md#release): refuses
uncommitted work, verifies the built CLI still runs under plain Node,
browser-based `npm login`, and tags `claude-foundry-v<version>`.

The version is read from `package.json` at runtime, so bump it there only.

## Testing by hand

There is no test suite. Run these against a throwaway `HOME` so your own
settings are not rewritten:

```bash
SB=$(mktemp -d); mkdir -p "$SB/.claude"
HOME="$SB" node dist/cli.js --status
```

Before a release:

1. `node dist/cli.js --help` under plain Node — the release script does this.
2. `--status` with no config — must explain how to set Foundry up, not crash.
3. `--status` with a `.claude/foundry.env` present — must report the repo-local
   file as the source, name the auth mode, and list unpinned model aliases.
4. `--status` with an API key set — the key must not appear in the output.
5. `--status` with a `settings.json` holding only `ANTHROPIC_DEFAULT_OPUS_MODEL`
   — must leave it alone, not move it into `foundry.env`.
6. `--status` with a `settings.json` holding `CLAUDE_CODE_USE_FOUNDRY` plus
   unrelated keys — must move the Foundry variables and keep the rest.
7. A placeholder resource, a resource that is a URL, and a resource plus a base
   URL — each must fail with its own message before anything launches.

Never commit a real resource name, deployment name, subscription ID, or key in
test fixtures or docs — see the repo-wide rule on client identifiers.
