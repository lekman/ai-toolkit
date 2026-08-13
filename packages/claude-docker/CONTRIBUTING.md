# Contributing to @lekman/claude-docker

Maintainer notes for this package. Repo-wide conventions are in
[docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md); read that first.

Consumer documentation is in [README.md](README.md) and stays that way.

## Layout

| Path                 | What it is                                                        |
| -------------------- | ----------------------------------------------------------------- |
| `src/cli.ts`         | The only entrypoint. Argument parsing and orchestration.          |
| `src/lib/engine.ts`  | Finding a container engine, and starting it when it is idle.      |
| `src/lib/image.ts`   | The Dockerfile and entrypoint, as strings, plus the build.        |
| `src/lib/session.ts` | Task naming, repo and key resolution, and the `docker run` args.  |

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

## Why the Dockerfile is a string

`src/lib/image.ts` holds the Dockerfile and the entrypoint as string constants,
and feeds them to `docker build -` as a hand-written tar on stdin. This is
deliberate. The package publishes as a single bundled `dist/cli.js`; a
Dockerfile shipped beside it would have to be located at runtime, and a
published CLI has no reliable idea where npm put it.

The image tag is a hash of both strings, so **editing either produces a new tag
and the next run rebuilds**. Do not add a version constant to bump by hand — it
will be forgotten, and a stale image is silent.

The tar writer is about forty lines and exists so the published bundle carries
no archive dependency for two small text files. If it ever needs to handle more
than that, replace it rather than extending it.

## Two constraints that are not preferences

**The container user must not be root.** Claude Code refuses
`--dangerously-skip-permissions` outright under root, and bypassing permissions
is the default here, so a root image does not start at all. This is why the
image creates a `claude` user and why `USER` is set before the entrypoint.

**`known_hosts` is baked at build time.** Without it, the first clone stops on
an interactive host-key prompt, which in a non-interactive container looks
exactly like a hang. `ssh-keyscan` at build time is what avoids that.

**The sandbox needs `seccomp=unconfined` on the container.** Claude Code's
sandbox uses bubblewrap, which creates a user namespace; Docker's default
seccomp profile blocks those syscalls, and bubblewrap fails with "No permissions
to create new namespace". `--cap-add SYS_ADMIN` does not fix it — it fails later
on `pivot_root` instead. So `runArgs` adds `--security-opt seccomp=unconfined`,
but only when `sandbox.enabled` is true in the settings file, because it trades
part of the outer boundary for the inner one. Reading the setting rather than
taking a flag is deliberate: Claude Code's own fallback when the sandbox cannot
start is a warning and unsandboxed execution, so a user who set `enabled: true`
and got no sandbox would not notice.

## The isolation model is the product

Changes that widen what the container can reach need a strong reason, because
the boundary is the entire value of this package. In particular:

- **Never mount the user's checkout.** The container clones the repo itself. A
  bind mount of the working copy would carry local branches, stashes, and
  untracked files into a bypassed-permissions session, and let it write back.
- **Never mount the user's `~/.claude`.** Config, hooks, and memory live in a
  Docker volume. Mounting the host directory would let the agent rewrite the
  settings and hooks that constrain it elsewhere.
- **Never forward the SSH agent.** A forwarded agent cannot be scoped to one
  repository, so it hands over every key the user owns. The read-only mount of a
  single dedicated key is the whole point.

A git worktree was considered for the checkout and does not work: a worktree's
`.git` is a pointer into the parent repository, and its object store lives
there, so mounting only the worktree yields "not a git repository" while
mounting the parent `.git` exposes every branch and object in the repo.

## Testing

There is no test suite. What is worth exercising by hand after a change to the
image or the entrypoint:

```bash
bun run check
bun src/cli.ts --status                    # engine detection, no side effects
bun src/cli.ts probe --shell               # build, clone, drop into a shell
```

The SSH transport cannot be exercised without a real dedicated account. The
clone, branch creation, and reuse logic can be, against a local bare repo:

```bash
git init --bare /tmp/probe.git             # seed it with one commit first
docker run --rm -i -v /tmp/work:/work -v /tmp:/srv \
  -v ~/.claude/docker/id_ed25519:/home/claude/.ssh/id_key:ro \
  -e CD_REPO=/srv/probe.git -e CD_BRANCH=task-1 -e CD_BASE=main \
  -e CD_GIT_NAME=t -e CD_GIT_EMAIL=t@e \
  claude-docker:<tag> bash -c 'git -C /work status -sb'
```

State in the PR what you did **not** test.
