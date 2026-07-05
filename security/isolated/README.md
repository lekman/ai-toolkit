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
- **`ask` (config-time)** — editing the files that _define_ the checks
  (`commitlint.config.mjs`, `.trunk/trunk.yaml`, `.trunk/configs/**`,
  `.claude/settings.json`, `.claude/hooks/**`) stops and asks for a human.

`deny` and `ask` are evaluated by the harness, so they apply even in `auto` or
bypass mode and even when the hook's runtime is gone. None of this is where
responsibility lives — the repo and CI still assert the same.

[settings.safety.json](settings.safety.json) is a **fragment** holding the
`deny` and `ask` blocks. Merge them into the repo's `.claude/settings.json`, and
wire the hook there too (the repo's own `.claude/settings.json` is the worked
example).

## Shared mode: worktree write-guard

The section above protects the repo's _guard rails_. This one protects the repo's
_working copy_, for a different situation: several agents, or an agent and a
human, sharing one checkout. There the risk is not a bypassed commit hook, it is
a partial or mistaken edit dirtying the tree that everyone else is also working
in.

The control is isolation applied one level in. Instead of a separate machine, the
agent gets a separate git worktree. The
[deny-local-writes hook](../../.claude/hooks/deny-local-writes.mjs) is a
`PreToolUse` guard that denies `Edit`, `Write`, and `NotebookEdit` anywhere in
the checkout, with two escape hatches:

- `.claude/worktrees/` — isolated git worktrees. Create one first (call
  `EnterWorktree`, or spawn the task with `isolation: 'worktree'`); edits there
  are allowed, and a mistake stays in the worktree.
- `.workflow/` — scratch or generated output.

Writes outside the checkout (for example `/tmp`, or the auto-memory directory
under `~/.claude`) are left alone: they do not touch the shared copy.

**Opt-in and per-user, on purpose.** Whether to force every edit through a
worktree is a workflow choice each contributor makes, not something the repo
should mandate for everyone. So wire it in `.claude/settings.local.json` (not the
committed `.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "sh \"$CLAUDE_PROJECT_DIR/.claude/hooks/deny-local-writes.sh\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Runtime and the fail-open gap.** The hook is dependency-free ESM
([`.mjs`](../../.claude/hooks/deny-local-writes.mjs)), and the
[shell wrapper](../../.claude/hooks/deny-local-writes.sh) runs it under node
first, then bun. The `.mjs` extension is what lets node treat it as ESM without a
`package.json`; bun runs it either way. Node is preferred because it is present
more often than bun, and this guard fails open: if no runtime can run it, the
edit is allowed rather than blocked. A stale node on `PATH` that is too old for
`.mjs` would crash, so the wrapper treats a non-zero exit as "this runtime could
not run it" and falls back to the next one before giving up.

Because it fails open, the hook is a nudge toward the worktree, not the
containment itself. The real containment is the worktree: the honest answer to
"what if an edit goes wrong here" is "it is isolated and I discard it". Pair the
hook with a discipline of always working in a worktree, and, on a disposable
machine, with mounting the guard-rail files read-only.

## Relationship to the machine level

[machine/](../machine/README.md) hard-**denies** editing settings and reading
secrets — right when the workstation is the thing at risk. This level adds the
repo's guard rails — right when the machine is disposable but the repo is not.
Pick the level(s) that match what a given context can lose; they are not meant to
be applied all at once.

For a stronger guarantee on a disposable machine, pair this with isolation:
mount the guard-rail files read-only so the agent cannot change them even with
approval bypassed.
