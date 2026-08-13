# Controls: soft, hard, boundary

Three kinds of control shape how an agent behaves here. They differ by *who*
enforces them and *what has to fail* for the control to fail. Knowing which is
which — and matching the strength to the stakes — is the point.

## Soft controls — advisory (the model enforces)

`CLAUDE.md`, the files under `standards/`, and rule files (the shareable
`rules/`, and a repo's own `.claude/rules/`) are **context**, not enforcement.
They are put in front of the model and it usually follows them — but it *can*
ignore them, and nothing stops it. They are suggestions with good intentions,
not guarantees.

Because they are only advice, **an agent may edit them.** Changing a suggestion
is low-stakes: it alters guidance, not a guarantee. If the model rewrites a rule
badly, the worst case is worse advice — caught in review.

## Hard controls — enforced by the harness (Claude Code enforces)

Hooks and `permissions` (`deny` / `ask`) are enforced by the Claude Code harness,
not by the model. A `PreToolUse` hook can block a tool call; a `deny` rule
refuses it; an `ask` rule forces a human prompt. The model does not get a vote.

Because they are the actual in-tool guarantees, **an agent must not edit or
bypass them without a human.** This repo gates them: `.claude/hooks/**`,
`.claude/settings.json`, and the guard-rail configs (`commitlint.config.mjs`,
`.trunk/trunk.yaml`) are `ask`-protected, while `.claude/rules/**` is
deliberately not — rules are suggestions, so editing them freely is fine.

But hard does not mean infallible. The harness is software: a bug, a
prompt-injection that steers it, a misconfiguration, or a disabled hook runtime
can all let a "hard" control fail open. It is enforced *inside* the thing you are
trying to constrain. For anything that really matters, do not stop here.

## Boundary controls — enforced outside Claude (the platform enforces)

For sensitive data or operations, put a wall the agent cannot cross **even if it
fully escapes the harness**. These are enforced by the OS, the container runtime,
the cloud provider, or GitHub — none of which trust Claude:

- **Machine boundary** — run the agent on a separate machine, in a container, or
  via the Agent SDK in an isolated runtime. A compromise stays in the sandbox.
- **Identity boundary** — a separate OS user; a separate GitHub account or a
  scoped, short-lived token; separate cloud environments, each with its own IAM
  role and least-privilege permissions.

The stance is defense in depth: assume the harness is *not* perfect, and arrange
that even a total failure of the soft and hard layers leaves a small, contained
blast radius. Give the agent the least access it needs, so "the agent did
something it shouldn't" stays survivable.

This generalises the isolation that [security/machine](../security/machine/README.md)
and [security/isolated](../security/isolated/README.md) already point to
(read-only mounts, no real credentials mounted): the real trust boundary is the
one Claude has no way to reach.

## A note on hook runtimes

A hook that shells out to a runtime (the commit-hook guard runs `bun`) fails open
if that runtime is gone — and it fails *immediately*, not after the timeout. Two
honest responses:

- **Guarantee the runtime at the boundary.** Bake `bun` into the container image
  or machine provisioning so the precise hook always runs. That belongs in the
  environment, not in a session-time install.
- **For a guard that must always run, drop the runtime.** Write it in POSIX `sh`,
  which is always present — at the cost of clumsier parsing.

A `SessionStart` tripwire can *warn* when bun, the guard hook, or the `deny`
rules look missing — visibility, not enforcement. And none of this is the final
layer: version control, Dependabot, and secret scanning with alerts catch what
slips through. Build hooks to shift left, not to be the last line.

## The rule of thumb

> An agent may rewrite the advice. It may not quietly remove the in-tool
> guarantee. And the guarantees that must hold no matter what live outside the
> tool entirely.

Match the control to the stakes: advice for preferences, hard controls for
mistakes that must not land, boundaries for data or operations where a harness
failure would be unacceptable.
