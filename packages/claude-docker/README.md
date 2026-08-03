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

With no task at all, it checks the setup and starts on the current repository,
named after it:

```bash
cd ~/Repo/acme/api
claude-docker            # task "api", reusing the same checkout each time
```

The first run walks you through the one manual step, the dedicated account and
its key. After that a bare `claude-docker` is the quickest way into a container
for whatever repo you are standing in.

## Why this exists

Bypassing permissions is what makes an agent useful for a long unattended task.
It is also what makes it dangerous on a laptop: the same agent can reach every
repo, key, and credential your user can. The usual answer is to approve each
tool call, which removes the reason you wanted it unattended.

This replaces the prompt with a boundary. The container clones **one repo, on
one branch, with a key belonging to a separate account**, and mounts nothing
else of yours.

Inside it, sessions run in **auto mode, never bypass**. That is deliberate:
bypass mode skips prompts for writes to `.claude`, `.git`, `.vscode` and others,
so it is incompatible with protecting them. Bypass is disabled in the container's
managed settings and cannot be re-enabled from inside. Auto mode still approves
the ordinary run without asking, so an unattended task is not slowed down; what
it does not do is hand the agent the keys to its own guard rails.

What the container can reach:

| Reach                      | Access                                          |
| -------------------------- | ----------------------------------------------- |
| One checkout of one branch | Cloned by the container itself, from the remote |
| One SSH key, read-only     | A dedicated account's key, not yours            |
| Its own`~/.claude`       | A Docker volume, never your host config         |

What it cannot reach: your working copy, your other repos, your SSH agent, your
`~/.claude`, your shell history, your cloud credentials.

## What a run does

```bash
cd ~/Repo/acme/api
claude-docker PROJ-123
```

1. **Checks the key.** That one exists, and that GitHub recognises it. The
   second half is the one people miss: an unattached key fails several seconds
   into the clone, as an SSH error that never mentions the key. The answer is
   cached against the key's modification time, so this costs a round trip once
   rather than on every launch.
2. **Finds a container engine.** If OrbStack or Docker Desktop is installed but
   not running, it starts it and waits — a stopped engine is the most common
   reason a container command fails, and it fails with a socket error that says
   nothing about the app being closed.
3. **Builds the image** on first run. The tag is a hash of the image definition,
   so editing it invalidates the build automatically.
4. **Clones inside the container.** `git@github.com:acme/api.git` is read from
   your `origin`, but the clone runs in the container over SSH with the
   dedicated key. Your own checkout is never mounted or copied, so no local
   branches, stashes, or untracked files come along.
5. **Creates the branch.** `PROJ-123` from the remote's default branch. If the
   branch already exists on the remote it is checked out instead.
6. **Starts Claude Code** in auto mode, with Remote Control on and the managed
   settings mounted read-only.

Re-running the same task reuses the existing checkout rather than cloning again.

## Set up the dedicated account

This is the part that makes the isolation real, and the first run walks you
through it. You can also run it on its own:

```bash
claude-docker --setup-key
```

It lists the keys already on this machine, asks GitHub who each one belongs to,
and lets you pick one or create a new one. If you create one, it offers to run
`gh auth login` for the dedicated account and attaches the key over the API, so
there is no public key to copy and no browser tab to get wrong.

Two things it checks that you cannot easily check yourself:

- **Which account a key belongs to.** `ssh -T git@github.com` answers
  `Hi <login>!`, so the tool reads the account off GitHub rather than asking you
  to remember. A key GitHub does not recognise is caught here instead of failing
  several seconds into a clone as an SSH error that never mentions the key.
- **Whether that account is one of yours.** It compares against the accounts
  `gh` is signed in to on this machine and refuses by default if they match.

**Do not use your own key.** An agent can push anywhere the key it holds can
reach. A dedicated account is what bounds that to repos you chose. For the same
reason your SSH agent is never forwarded, since a forwarded agent cannot be
scoped to one repo.

Keys held in an agent, such as 1Password's, are not offered. Only the public
half is on disk, and the container needs the private half as a file.

By hand, if you would rather:

```bash
mkdir -p ~/.claude/docker
ssh-keygen -t ed25519 -N "" -C claude-docker -f ~/.claude/docker/id_ed25519
cat ~/.claude/docker/id_ed25519.pub    # add to the dedicated account
```

The key is mounted read-only, so the container can authenticate with it but not
alter or replace it. If the key on your host is group or world readable, it is
chmod'ed to `0600` before the run: SSH refuses a loose key anyway, and it fails
several seconds into the clone with an error that never mentions permissions.
That is the one file outside `~/.claude/docker` this tool will change, and only
when you point `--ssh-key` at it.

## Log in once

Claude Code's config lives in a Docker volume (`claude-docker-config`), separate
from your host `~/.claude`. The first run asks you to log in:

```
Not logged in · Please run /login
```

Do that once. The volume keeps it across tasks and across image rebuilds. Your
own Claude config, history, hooks, and memory are never mounted, so the agent
cannot rewrite them.

## Configure the container

```bash
claude-docker --config
```

Opens two files in VS Code (or `$EDITOR`), created with sensible defaults on
first use:

| File                               | What it is                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `~/.claude/docker/settings.json` | Claude Code settings for every container, including the sandbox network lists |
| `~/.claude/docker/CLAUDE.md`     | Global memory for every containerised task                                    |

Both live on your host and are mounted into the container read-only, so they are
ordinary files you can edit, diff, and commit, and the agent has no path to
either. Everything else Claude Code writes — the login, session history — stays
in the volume.

**`settings.json` goes in as Claude Code's managed policy**, at
`/etc/claude-code/managed-settings.json`, not as user settings. That matters
because the checkout at `/work` is writable by design — that is the work — so a
project-level `.claude/settings.local.json` is always within the agent's reach.
User settings lose to it. Managed settings sit at the top of the precedence order
and cannot be overridden by anything, and two managed-only keys close the rest:

| Key                                | Effect                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `allowManagedPermissionRulesOnly` | User and project settings cannot define `allow`, `ask`, or `deny` rules at all     |
| `allowManagedHooksOnly`           | A cloned repo cannot register hooks, so it cannot run a command on every tool call |

The second one closes a path that is easy to miss: without it, any repo you clone
can ship a `.claude/settings.json` that registers a `PreToolUse` hook, and that
hook runs shell on every tool call in a container you are not watching.

### Keeping your standing instructions

Your own `~/.claude/CLAUDE.md` probably imports standards from a repo by
absolute path:

```markdown
@~/Repo/lekman/ai-toolkit/standards/CLAUDE.md
```

That path does not exist in the container, so the import resolves to nothing and
the agent loses every standing instruction you have. It fails silently: you
notice it as the agent behaving unlike itself, not as a missing file.

Point `claude-docker` at the directory and the imports resolve:

```bash
ln -s ~/Repo/lekman/ai-toolkit/standards ~/.claude/docker/standards
```

It is mounted read-only at `~/.claude/standards` in the container, and the
seeded `CLAUDE.md` already imports `@standards/CLAUDE.md`. A symlink means the
container reads whatever the repo currently says rather than a copy that drifts.

Use `--standards <dir>` or `CLAUDE_DOCKER_STANDARDS` to point somewhere else.
`--status` shows whether anything is mounted, and a launch with nothing mounted
says so rather than leaving you to work it out.

### The guard hook

Because repo hooks no longer load, hooks you want must live in this file. The
seeded default registers one, `/usr/local/bin/claude-docker-guard`, baked into
the image. It is a `PreToolUse` hook on Bash and blocks two things:

- **Shell writes into any `.claude` directory.** A deny rule covers the Write and
  Edit tools; it does nothing about `echo x > .claude/settings.local.json`,
  because that is a Bash call. A hook exiting 2 stops the call before permission
  rules are even evaluated.
- **Pushing to the base branch.** The task branch is the unit of work. The base
  branch is updated by review, not by the agent.

It is shift-left, not the guarantee, and the README section on what this does
not protect against says why. `jq` is baked into the image on purpose: a guard
that shells out to a runtime fails open when the runtime is missing, so the
runtime is guaranteed at the boundary rather than assumed.

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
    "enableWeakerNestedSandbox": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": [],
    "network": {
      "strictAllowlist": true,
      "allowedDomains": [
        "api.anthropic.com",
        "registry.npmjs.org",
        "github.com",
        "*.githubusercontent.com"
      ],
      "deniedDomains": [],
      "allowUnixSockets": [],
      "allowLocalBinding": true
    }
  }
}
```

**The shape matters more than it looks.** `sandbox` and `sandbox.network` are
both strict objects, so a single unknown key inside either makes Claude Code
discard the whole block and carry on with a one-line warning. Three easy
mistakes, all of which look like they work:

- `strictAllowlist` belongs on `network`, not on `sandbox`. On `sandbox` it is
  rejected, and the setting that makes the sandbox deny is the one you lose.
- `autoAllowBashIfSandboxed` belongs inside `sandbox`, not at the top level.
  The top level accepts unknown keys, so it is silently ignored there.
- `allowUnixSockets` takes an array of socket paths. `false` is a type error;
  use `[]`. The boolean is `allowAllUnixSockets`.

Do not add `//` comment keys inside `sandbox` or `network` either, for the same
reason. Comments at the top level are fine.

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
- **`network.strictAllowlist` is what makes it deny.** Without it the sandbox
  *prompts* for an unlisted host — no use in an unattended run, which is the
  whole point here. It requires Claude Code 2.1.219 or later.
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
claude-docker                     # check the setup, then start on this repo
claude-docker <task>              # clone and start work
claude-docker --setup-key         # pick or create the clone key, attach it to an account
claude-docker --config            # edit settings.json and CLAUDE.md
claude-docker --status            # engine, image, key account, sessions; changes nothing
claude-docker --clean             # remove built images
```

| Flag                            | Effect                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `--repo <url>`                | Repository to clone. Default:`origin` of the current repo, rewritten to SSH |
| `--base <branch>`             | Branch to start from. Default: the remote's`HEAD`                           |
| `--ssh-key <path>`            | Key to clone with. Default:`~/.claude/docker/id_ed25519`                    |
| `--standards <dir>`           | Shared instruction files, mounted read-only. Also`CLAUDE_DOCKER_STANDARDS`  |
| `--git-name`, `--git-email` | Commit author. Also`CLAUDE_DOCKER_GIT_NAME` / `_EMAIL`                    |
| `--shell`                     | Open a shell in the container instead of Claude Code                          |
| `--rm`                        | Delete the session checkout afterwards                                        |
| `--no-start`                  | Fail rather than starting the container engine                                |
| `--rebuild`                   | Rebuild the image first                                                       |

Anything after `--` goes to `claude` untouched:

```bash
claude-docker PROJ-123 -- --model opus
```

## Remote Control

Always on, and named `@docker <branch>`:

```text
@docker feat/JIRA-12345
```

A containerised task is an unattended task by definition, and one you cannot
watch from anywhere is one you end up babysitting from the terminal that started
it. The `@docker` prefix separates containerised sessions from ones running on
the machine itself at a glance, and the branch suffix means the session, the
branch, and the pull request all read as the same string.

Task names keep their case for the same reason, so `feat/JIRA-12345` stays
uppercase rather than becoming `feat/jira-12345`.

## What this does not protect against

Be clear about the boundary, because a container is not a sandbox in the
strongest sense.

- **The network is open.** The container reaches the internet normally, which
  Claude Code needs. A prompt-injected agent can send anything inside the
  container out, and neither auto mode nor the managed rules change that. The
  container boundary protects the rest of your machine, not the contents of the
  task. Narrow it with the sandbox above, and note that the sandbox covers Bash
  only — `WebFetch` and MCP need a proxy.
- **The dedicated account is a real account.** Anything it can reach, the agent
  can reach. Scope it to the repos you actually want touched.
- **A container is not a VM.** It is a strong boundary for accident and a good
  one for misuse, but kernel-level escapes exist. For a genuinely hostile
  workload, use a disposable VM.
- **The guard hook is not the guarantee.** Tool-scoped deny rules stop the Write
  and Edit tools, not `echo x > .claude/settings.local.json`, which is a Bash
  call. The `PreToolUse` guard covers the ordinary shell forms, but shell is not
  reliably parseable and `python -c`, base64, or a script written elsewhere and
  then run will get past it. What holds is the managed settings file itself:
  `allowManagedPermissionRulesOnly` means a rule written in the checkout is never
  read at all, so getting past the hook gains nothing.
- **Managed settings are only unreachable while the mount holds.** The file is
  root-owned inside a container running as `claude`, and mounted read-only. That
  is a filesystem boundary, not a Claude Code one, which is why it is the control
  worth relying on. It still assumes the container itself holds.

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
