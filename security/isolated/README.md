# Isolated agent

**Practice:** protect the **repo** — not the machine — from an agent that quietly
weakens its own guard rails.

Use this level when you run an isolated or remote agent (a spare Mac Mini, a
Docker container, a throwaway VM). There the machine is disposable and holds no
secrets, so [machine-level security](../machine/README.md) may not apply — but
the repo still does. The agent must not relax or circumvent the commit checks,
and must not reconfigure itself, without a human approving the change.

This is less relevant to a hardened Agent SDK deployment that ships its own
controls. It matters most for an isolated, interactive-style agent working in a
repo.

## Layered, so no single failure unblocks it

"An agent may offer to change a guard rail, but a human must approve it" is
enforced in layers, because any one layer can fail:

- **`deny` (core-enforced)** — the harness refuses the blunt bypass commands
  (`git commit --no-verify`, `core.hooksPath` overrides). It needs no external
  runtime, so it holds even if `bun` is removed or disabled. It is prefix-matched
  and therefore porous (it misses odd flag positions and `rtk`-style rewrites) —
  a backstop, not the whole defence.
- **`PreToolUse` hook (precise)** — a small `bun` script (see
  [the guard hook](../../.claude/hooks/no-verify-guard.ts)) parses the command
  and catches what the prefix `deny` misses. It runs with a `timeout`. A
  `PreToolUse` hook only blocks on exit code 2 (or a JSON `deny`); if `bun` is
  missing or the hook times out, Claude Code lets the command through — which is
  exactly why the `deny` backstop and CI exist.
- **`ask` (config-time)** — editing the files that *define* the checks
  (`commitlint.config.mjs`, `.trunk/trunk.yaml`, `.trunk/configs/**`,
  `.claude/settings.json`, `.claude/hooks/**`) stops and asks for a human.

`deny` and `ask` are evaluated by the harness, so they apply even in `auto` or
bypass mode and even when the hook's runtime is gone. None of this is where
responsibility lives — the repo and CI still assert the same.

[settings.safety.json](settings.safety.json) is a **fragment** holding the
`deny` and `ask` blocks. Merge them into the repo's `.claude/settings.json`, and
wire the hook there too (the repo's own `.claude/settings.json` is the worked
example).

## Relationship to the machine level

[machine/](../machine/README.md) hard-**denies** editing settings and reading
secrets — right when the workstation is the thing at risk. This level adds the
repo's guard rails — right when the machine is disposable but the repo is not.
Pick the level(s) that match what a given context can lose; they are not meant to
be applied all at once.

For a stronger guarantee on a disposable machine, pair this with isolation:
mount the guard-rail files read-only so the agent cannot change them even with
approval bypassed.
