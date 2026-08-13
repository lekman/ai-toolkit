# Contributing to @lekman/claude-local

Maintainer notes for this package. Repo-wide conventions are in
[docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md); read that first.

Consumer documentation is in [README.md](README.md) and stays that way — nothing
in it should assume you have the repo checked out.

## Layout

| Path                 | What it is                                              |
| -------------------- | ------------------------------------------------------- |
| `src/cli.ts`         | The only entrypoint. Argument parsing and dispatch.     |
| `src/commands/`      | One file per verb: setup, switch, launch.               |
| `src/lib/catalog.ts` | The model list and the memory arithmetic that sizes it. |
| `src/lib/lms.ts`     | Everything that shells out to LM Studio's `lms` CLI.    |
| `src/lib/config.ts`  | Persisted state and the env vars handed to Claude Code. |
| `src/lib/system.ts`  | Machine facts and process helpers. Node APIs only.      |

Build and release scripts are shared by every package and live at the repo root
in [scripts/build.ts](../../scripts/build.ts) and
[scripts/release.ts](../../scripts/release.ts).

## Develop

```bash
bun install        # at the repo root — one lockfile for all packages
bun run check      # typecheck, then build
bun src/cli.ts     # run from source, no build step
```

Two rules that are easy to break and expensive to break:

**Node APIs only in `src/`.** Bun builds this package but never runs it for a
user. `Bun.spawn`, `Bun.file`, and friends compile happily and then crash on
every install. Use `node:child_process` and `node:fs`.

**Dependencies stay in `devDependencies`.** The build bundles them, so the
published package has none and a cold `npx` installs nothing. Moving one to
`dependencies` silently reintroduces an install step for every user.

## Adding a model

Add an entry to `MODELS` in [src/lib/catalog.ts](src/lib/catalog.ts). The fields
that matter:

- `sizeGb` — the 4-bit MLX download size, for the disk-space check.
- `minRamGb` — total unified memory needed for the weights _plus_ a usable
  context window. macOS wires about 75% of RAM to the GPU, so this is not the
  same as `sizeGb`. Models above the machine's RAM are filtered out of the
  picker rather than offered and then failing.
- `role` — `main` is something you work with, `background` is titles and
  summaries. Setup guarantees at least one `main` gets installed.

Check the key against the LM Studio catalog before committing it; a wrong key
fails at download time with a confusing error rather than at review time.

## Release

```bash
bun run release --dry-run   # everything except the publish call
bun run release             # publish
bun run release --tag next  # publish under a different dist-tag
```

[scripts/release.ts](../../scripts/release.ts) is shared by every package: it
compares each workspace package's local version with the npm registry and
publishes only the ones that are ahead. It refuses to publish anything that is
not committed, builds, copies the
repo `LICENSE` in, and then verifies the artifact before it goes out: the CLI
must still carry its shebang, still be executable, and still run `--help` under
plain Node. That last check is the only thing standing between a Bun-only API in
the bundle and a package that installs fine and then crashes for every user.

It prints the tarball contents for you to read, asks once, publishes, and tags
`claude-local-v<version>` locally for you to push.

Bump the version in `package.json` **and** the `VERSION` constant in
[src/cli.ts](src/cli.ts), which is what `--version` prints.

### Authentication

`npm login` — a browser round trip through your identity provider and 2FA. No
token is written into the repo, the environment, or CI. That is not only a
preference: npm revoked classic tokens in early 2026, and write-enabled granular
tokens now expire in days rather than years, so a long-lived local token is no
longer something you can have.

**Publishing from CI instead?** Use
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) rather than
putting a token in a secret. GitHub Actions authenticates over OIDC, needs no
credential at all, and attaches a provenance attestation automatically. It
requires npm 11.5.1 or later and `id-token: write` on the job. Provenance cannot
be produced from a laptop, which is why the release script does not ask for it —
if provenance matters to you, release from CI, not from here.

## Testing by hand

There is no test suite. The parts worth exercising before a release, in order of
how badly they fail if broken:

1. `node dist/cli.js --help` under plain Node, not Bun. The release script does
   this for you.
2. `claude-local --status` on a machine with no config — must report "not set
   up", not start installing.
3. `claude-local --model <bad-key>` — must fail with a readable message.
4. First-run setup on a machine with no LM Studio. Slow and destructive to your
   disk space, so do it deliberately, not on every change.
