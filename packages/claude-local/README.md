# @lekman/claude-local

Run Claude Code against a model on your own machine. Two commands: one to
install, one to swap models.

Apple Silicon only. The practice behind it — why local, what it costs, and when
it is the wrong choice — is in
[practices/local-models/README.md](../../practices/local-models/README.md).

## Use

```bash
npx -p @lekman/claude-local setup-claude-local
npx -p @lekman/claude-local switch-claude-local
```

The `-p` is needed because the package ships two commands and neither is named
after it. Or install once and drop the ceremony:

```bash
npm install -g @lekman/claude-local
setup-claude-local
```

The published package bundles its dependencies, so `npx` installs nothing and
starts cold in about a second. Node 20 or later is the only requirement — Bun
builds it, but users never need Bun.

## setup-claude-local

Checkbox list of what to install. The core pack — LM Studio, its `lms` CLI, and
the `claude-local` wrapper — is always included; models are yours to pick.
Anything that will not fit in your machine's memory is left out of the list
rather than offered and then failing.

```
◆  What should be installed?
│  ◼ Core pack
│     LM Studio, the lms CLI, and the claude-local wrapper — always installed
│  ◼ Qwen3-Coder 30B A3B  17 GB
│     The one you work with. MoE, 3.3B active, ~30 tok/s.
│  ◼ Gemma 4 E4B  6 GB
│     Background model for titles and summaries.
│  ◻ Gemma 4 26B A4B  16 GB
│  ◻ Gemma 4 31B  19 GB
```

It then downloads what is missing, starts the server, loads the main model with
a context window sized to your RAM, and writes the wiring.

| Flag          | Effect                                      |
| ------------- | ------------------------------------------- |
| `--yes`, `-y` | Take the recommended selection, no prompts  |
| `--port <n>`  | Serve on this port (default 1234)           |
| `--no-server` | Install only; do not start or load anything |

Re-running is safe. Every step checks first.

## switch-claude-local

Reads what is on disk and what is in memory, then runs the swap for the model
you pick — start server, unload, load with the right context, and rewrite the
wrapper's default so `claude-local` follows.

Only one model fits in unified memory at a time, so this swaps rather than adds.
Models in the catalog that are not downloaded yet are offered too, and fetched
on demand.

| Flag                       | Effect                                        |
| -------------------------- | --------------------------------------------- |
| `--list`, `-l`             | Show what is downloaded and loaded, then exit |
| `--model <key>`            | Switch to this model without prompting        |
| `--context <n>`            | Override the context window                   |
| `--port <n>`               | Server port (default: whatever setup wrote)   |
| `--launch` / `--no-launch` | Start `claude-local` when done, or never ask  |

## What It Writes

| Path                        | Purpose                                           |
| --------------------------- | ------------------------------------------------- |
| `~/.claude/local-model.env` | The `ANTHROPIC_*` variables pointing at localhost |
| `~/.local/bin/claude-local` | Wrapper that sources them and execs `claude`      |

Nothing is exported into your shell profile. That is deliberate: a stray
`ANTHROPIC_BASE_URL` in `.zshrc` would silently send every normal `claude`
session to the weaker local model, and you would notice as confusing quality
rather than as an error. Here you opt in per command — `claude-local` is local,
`claude` is untouched.

## Undo

```bash
lms server stop
rm ~/.local/bin/claude-local ~/.claude/local-model.env
npm uninstall -g @lekman/claude-local
brew uninstall --cask lm-studio
rm -rf ~/.lmstudio            # downloaded models, tens of GB
```

## Develop

```bash
bun install
bun run check      # typecheck, then build
bun src/setup.ts   # run from source
```

## Release (maintainers)

```bash
bun run release --dry-run   # everything except the publish call
bun run release             # publish
bun run release --tag next  # publish under a different dist-tag
```

[scripts/release.ts](scripts/release.ts) refuses to publish anything that is not
committed, checks the version is not already on the registry, builds, copies the
repo `LICENSE` in, and then verifies the artifact before it goes out: each CLI
must still carry its shebang, still be executable, and still run `--help` under
plain Node. That last check is the only thing standing between a Bun-only API in
the bundle and a package that installs fine and then crashes for every user.

It prints the tarball contents for you to read, asks once, publishes, and tags
`claude-local-v<version>` locally for you to push.

Authentication is `npm login` — a browser round trip through your identity
provider and 2FA. No token is written into the repo, the environment, or CI. That
is not only a preference: npm revoked classic tokens in early 2026, and
write-enabled granular tokens now expire in days rather than years, so a
long-lived local token is no longer something you can have.

**Publishing from CI instead?** Use
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) rather than
putting a token in a secret. GitHub Actions authenticates over OIDC, needs no
credential at all, and attaches a provenance attestation automatically. It
requires npm 11.5.1 or later and `id-token: write` on the job. Provenance cannot
be produced from a laptop, which is why this script does not ask for it — if
provenance matters to you, release from CI, not from here.
