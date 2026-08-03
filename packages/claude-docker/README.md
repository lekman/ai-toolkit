# @lekman/claude-docker

Run one Claude Code task in a container that holds nothing but that task.

## Use

```bash
npx @lekman/claude-docker PROJ-123
```

Or install once:

```bash
npm install -g @lekman/claude-docker
claude-docker PROJ-123
```

The published package bundles its dependencies, so `npx` installs nothing. Node
20 or later, plus a container engine, are the only requirements.

## Why this exists

Bypassing permissions is what makes an agent useful for a long unattended task.
It is also what makes it dangerous on a laptop: the same agent can reach every
repo, key, and credential your user can. The usual answer is to approve each
tool call, which removes the reason you wanted it unattended.

This replaces the prompt with a boundary. The container clones **one repo, on
one branch, with a key belonging to a separate account**, and mounts nothing
else of yours. Inside that, permissions are bypassed by default — there is
nothing left for a prompt to protect that the boundary does not already cover.

What the container can reach:

| | |
| --- | --- |
| One checkout of one branch | Cloned by the container itself, from the remote |
| One SSH key, read-only | A dedicated account's key, not yours |
| Its own `~/.claude` | A Docker volume, never your host config |

What it cannot reach: your working copy, your other repos, your SSH agent, your
`~/.claude`, your shell history, your cloud credentials.

## What a run does

```bash
cd ~/Repo/acme/api
claude-docker PROJ-123
```

1. **Finds a container engine.** If OrbStack or Docker Desktop is installed but
   not running, it starts it and waits — a stopped engine is the most common
   reason a container command fails, and it fails with a socket error that says
   nothing about the app being closed.
2. **Builds the image** on first run. The tag is a hash of the image definition,
   so editing it invalidates the build automatically.
3. **Clones inside the container.** `git@github.com:acme/api.git` is read from
   your `origin`, but the clone runs in the container over SSH with the
   dedicated key. Your own checkout is never mounted or copied, so no local
   branches, stashes, or untracked files come along.
4. **Creates the branch.** `PROJ-123` from the remote's default branch. If the
   branch already exists on the remote it is checked out instead.
5. **Starts Claude Code** with Remote Control on and permissions bypassed.

Re-running the same task reuses the existing checkout rather than cloning again.

## Set up the dedicated account

This is the part that makes the isolation real, and it is the one manual step.

Create a second GitHub account, give it access to only the repos it should
touch, and give it its own key:

```bash
mkdir -p ~/.claude/docker
ssh-keygen -t ed25519 -N "" -C claude-docker -f ~/.claude/docker/id_ed25519
cat ~/.claude/docker/id_ed25519.pub    # add to the dedicated account
```

**Do not use your own key.** An agent with permissions bypassed can push
anywhere the key it holds can reach. A dedicated account is what bounds that to
repos you chose. For the same reason your SSH agent is never forwarded — a
forwarded agent cannot be scoped to one repo.

The key is mounted read-only, so the container can authenticate with it but not
alter or replace it.

## Log in once

Claude Code's config lives in a Docker volume (`claude-docker-config`), separate
from your host `~/.claude`. The first run asks you to log in:

```
Not logged in · Please run /login
```

Do that once. The volume keeps it across tasks and across image rebuilds. Your
own Claude config, history, hooks, and memory are never mounted, so an agent
with permissions bypassed cannot rewrite them.

## Configure the container

```bash
claude-docker --config
```

Opens two files in VS Code (or `$EDITOR`), created with sensible defaults on
first use:

| File | What it is |
| ---- | ---------- |
| `~/.claude/docker/settings.json` | Claude Code settings for every container, including the sandbox network lists |
| `~/.claude/docker/CLAUDE.md` | Global memory for every containerised task |

Both live on your host and are mounted into the container over the config
volume, so they are ordinary files you can edit, diff, and commit. Everything
else Claude Code writes — the login, session history — stays in the volume.

### Narrowing egress with the sandbox

The container has open egress by default, because the container is the boundary.
For a second, inner boundary, Claude Code's sandbox is a simpler lever than
firewall rules: it enforces a domain allowlist at the OS level, so it holds
regardless of what the model decided to run.

The seeded `settings.json` has it pre-filled and switched off. Turn it on with
one line — `"enabled": true`:

```json
{
  "sandbox": {
    "enabled": false,
    "strictAllowlist": true,
    "enableWeakerNestedSandbox": true,
    "network": {
      "allowedDomains": [
        "api.anthropic.com",
        "registry.npmjs.org",
        "github.com",
        "*.githubusercontent.com"
      ],
      "deniedDomains": [],
      "allowUnixSockets": false,
      "allowLocalBinding": true
    }
  },
  "autoAllowBashIfSandboxed": true
}
```

`claude-docker` reads that file and, when the sandbox is on, runs the container
with `--security-opt seccomp=unconfined`. That is not optional: the sandbox uses
bubblewrap, bubblewrap creates a user namespace, and Docker's default seccomp
profile blocks the syscalls it needs — so without it the sandbox cannot start,
and Claude Code's fallback is to warn once and run **unsandboxed**, which is the
worst outcome. Note the trade: this relaxes the outer boundary to enable the
inner one. It is only worth it because the inner one then exists.

Five things are worth knowing before you rely on it:

- **It covers Bash commands and their child processes only.** `WebFetch` and MCP
  servers follow [permission rules](https://code.claude.com/docs/en/permissions)
  instead, so an allowlist here does not constrain them.
- **`strictAllowlist` is what makes it deny.** Without it the sandbox *prompts*
  for an unlisted host — no use in an unattended run, which is the whole point
  here. It requires Claude Code 2.1.219 or later.
- **`enableWeakerNestedSandbox` is required inside a container.** Bubblewrap
  cannot mount a fresh `/proc` unprivileged, so a sandbox nested in a container
  will not start without it. It weakens the inner boundary, which is acceptable
  only because the container is the outer one.
- **`docker` is incompatible with the sandbox.** Add it to `excludedCommands` if
  a task needs it.
- **It is the inner of two boundaries, not a replacement for either.** If you
  only want one, keep the container and leave this off.

The image ships `bubblewrap`, `socat`, and `@anthropic-ai/sandbox-runtime`, so
the dependencies are already in place. `deniedDomains` always beats
`allowedDomains`, and a broad entry such as `github.com` is a plausible
exfiltration path — the proxy does not inspect TLS by default.

## Commands

```bash
claude-docker <task>              # clone and start work
claude-docker --config            # edit settings.json and CLAUDE.md
claude-docker --status            # engine, image, sessions; changes nothing
claude-docker --clean             # remove built images
```

| Flag | Effect |
| ---- | ------ |
| `--repo <url>` | Repository to clone. Default: `origin` of the current repo, rewritten to SSH |
| `--base <branch>` | Branch to start from. Default: the remote's `HEAD` |
| `--ssh-key <path>` | Key to clone with. Default: `~/.claude/docker/id_ed25519` |
| `--git-name`, `--git-email` | Commit author. Also `CLAUDE_DOCKER_GIT_NAME` / `_EMAIL` |
| `--shell` | Open a shell in the container instead of Claude Code |
| `--rm` | Delete the session checkout afterwards |
| `--permissions` | Ask for permissions as usual, rather than bypassing them |
| `--no-remote-control` | Start without Remote Control |
| `--no-start` | Fail rather than starting the container engine |
| `--rebuild` | Rebuild the image first |

Anything after `--` goes to `claude` untouched:

```bash
claude-docker PROJ-123 -- --model opus
```

## Remote Control

The session starts with `--remote-control <task>`, named after the task, so a
long unattended run is watchable from anywhere rather than only from the
terminal that started it. `--no-remote-control` turns it off.

## What this does not protect against

Be clear about the boundary, because a container is not a sandbox in the
strongest sense.

- **The network is open.** The container reaches the internet normally, which
  Claude Code needs. Claude Code's own help recommends bypassing permissions
  only in a sandbox with no internet access — that is not achievable while the
  agent must reach the API. A prompt-injected agent can send anything inside the
  container out. The container boundary protects the rest of your machine, not
  the contents of the task.
- **The dedicated account is a real account.** Anything it can reach, the agent
  can reach. Scope it to the repos you actually want touched.
- **A container is not a VM.** It is a strong boundary for accident and a good
  one for misuse, but kernel-level escapes exist. For a genuinely hostile
  workload, use a disposable VM.

## Requirements

- Node 20 or later.
- A container engine: [OrbStack](https://orbstack.dev) (lighter and faster on a
  Mac) or [Docker Desktop](https://docker.com/products/docker-desktop). Either
  is started automatically if installed but not running.
- `git` on your PATH, to read the repository's `origin`.
- A dedicated GitHub account and key, as above.

## Undo

```bash
npm uninstall -g @lekman/claude-docker
claude-docker --clean                      # built images
docker volume rm claude-docker-config      # the container's Claude login
rm -rf ~/.claude/docker                    # sessions and the key
```

Your own `claude`, your `~/.claude`, and your repos are never modified.

## Contributing

Building, testing, and releasing: [CONTRIBUTING.md](CONTRIBUTING.md).
