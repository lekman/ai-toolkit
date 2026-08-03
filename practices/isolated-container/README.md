# Isolated container

Run the agent somewhere it can only reach the task. Then stop asking it for
permission.

## The trade everyone makes badly

An agent that stops to ask before every command is safe and nearly useless for
anything long-running. An agent with permissions bypassed is useful and, on a
laptop, reaches everything you do: every repo, every SSH key, every cloud
credential, your shell history, and the settings and hooks that were supposed to
constrain it.

Most teams resolve this by alternating — approve each call when it matters,
bypass when it is tedious. That is the worst of both, because the decision is
made when you are impatient rather than when you are thinking.

The better move is to change what "bypassed" means. Bypassing permissions is
only dangerous in proportion to what is reachable. Put the agent somewhere that
holds one repository, one branch, and one credential, and the per-call prompt
stops protecting anything the boundary does not already cover.

Prompts are a **soft control**: they depend on a human reading them and on the
agent surfacing what it is doing. A container is a **hard control**: it holds
whether or not anyone is watching. See [hard and soft controls](../../docs/controls.md).

## What the container must not hold

The boundary is only worth what you keep out of it. Three mistakes undo it, and
all three are the convenient option.

**Do not mount your working copy.** It is tempting — the agent then sees exactly
what you see. It also carries your local branches, your stashes, and your
untracked files into a session with permissions bypassed, and lets it write back
over them. Have the container clone the repository itself. What arrives is what
is on the remote, and nothing else.

**Do not mount your `~/.claude`.** Config, hooks, and memory are the machinery
that constrains the agent elsewhere. An agent that can rewrite them has been
handed the keys to its own guard rails, and the change outlives the container.
Give it its own.

**Do not forward your SSH agent.** This is the one that looks harmless. A
forwarded agent cannot be scoped to a single repository, so it hands over every
key you own — including whatever your employer's org trusts. Use one key
belonging to a separate account with access to only the repositories you chose.

The dedicated account is the part that takes real effort, and it is the part
that makes the rest true. Without it, "isolated" means the agent cannot see your
files but can still push to anything you can.

## One task, one container

Name the container after the task — usually a ticket. Let that name be the
branch, the checkout, and the session. Two things follow.

The blast radius of a mistake is one branch you have not merged. Nothing needs
undoing on your machine, because nothing on your machine changed.

And the container becomes disposable in a way a long-lived dev container is not.
A dev container accumulates state, and after a week nobody knows what is in it.
A per-task container is created, used, and deleted inside one piece of work.

## Layers inside the boundary

A container is not the end of it. Two further layers cost little.

**A domain allowlist inside the container.** The container needs the internet —
Claude Code cannot reach the API without it — so egress cannot be closed. It can
be bounded: Claude Code's sandbox enforces `sandbox.network.allowedDomains` and
`deniedDomains` at the OS level, so the limit holds regardless of what the model
decided to run. Simpler than firewall rules, and it denies rather than hangs.

Two caveats decide whether it is worth it. It covers Bash commands and their
children only, so it does not constrain `WebFetch` or MCP servers. And nesting a
sandbox inside a container requires relaxing the container's own seccomp profile
— bubblewrap needs to create a user namespace, and the default profile blocks
that. You are loosening the outer boundary to gain the inner one. That is a
reasonable trade when the inner one is what limits egress, and a bad one if you
turn it on and never populate the allowlist.

**The repo's own guard rails still apply.** Being in a container does not mean
the agent may weaken commit checks or reconfigure itself. That concern is
[isolated-agent security](../../security/isolated/README.md), and it holds
inside the container as much as outside.

## What this does not buy you

Be precise about the boundary, or it becomes a comfort rather than a control.

- **The task's own contents are still exposed.** With egress open, a
  prompt-injected agent can send anything in the container out. The container
  protects the rest of your machine; it does not protect the repository it holds.
- **A container is not a virtual machine.** It is a strong boundary against
  accident and a good one against misuse, but kernel-level escapes exist. A
  genuinely hostile workload belongs in a disposable VM.
- **The dedicated account is a real account.** Everything it can reach, the agent
  can reach. Scoping it is not paperwork; it is the control.

## Driven by

[@lekman/claude-docker](../../packages/claude-docker/README.md) implements this:
it finds or starts a container engine, clones one repository on one branch with
a dedicated key, mounts nothing else of yours, and bypasses permissions inside.
`claude-docker --config` opens the container's `settings.json` and `CLAUDE.md`
so the sandbox lists and standing instructions above are yours to set.

Further reading: [defence in depth for agents](https://www.lekman.com/blog/ai-security-defence-in-depth-for-agents).
