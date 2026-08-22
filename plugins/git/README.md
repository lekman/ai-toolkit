# Git

Git workflow: three skills you invoke, and a hook that runs whether you
remember it or not.

- **`/git:commit`**: [skills/commit/SKILL.md](skills/commit/SKILL.md). Groups
  changed files by what they are for, generates a conventional message per
  group, runs the repository's QA and hooks, and creates several focused commits
  rather than one large one.
- **`/git:pr`**: [skills/pr/SKILL.md](skills/pr/SKILL.md). Opens a pull request
  using the repository's own template, or the plugin's default when it has none.
- **`/git:purge`**: [skills/purge/SKILL.md](skills/purge/SKILL.md).
  Fast-forwards the default branch, deletes local and remote branches whose work
  is already merged, and turns on delete-branch-on-merge so it stops recurring.
- **The stack guard**: [hooks/stack-guard.sh](hooks/stack-guard.sh). Stops a
  second pull request against the default branch while one of yours is still
  open, and points at `gh stack`.

## Why Purge Does Not Trust `git branch --merged`

A squash merge rewrites a branch into one new commit on the default branch, so
the branch's own commits are never ancestors of it. `git branch --merged` then
reports nothing merged, and it is right: those commits genuinely are not there.
The work is. In a squash-merge repository the pull request is the only
authoritative record of that, which is why `/git:purge` asks GitHub rather than
the commit graph.

Two more traps it handles, both of which make a merged branch look like live
work:

- **A dangling upstream ref.** When the remote branch is deleted on merge, the
  local branch keeps pointing at it until `git fetch --prune`. Until then every
  ahead/behind count is computed against a branch that no longer exists.
- **An orphan history.** After a history rewrite or an import, a branch can
  share no common ancestor with the default branch. `git diff main...branch`
  then fails outright, and ahead/behind counts and `git cherry` compare
  unrelated roots — "39 commits ahead" describes nothing at all. Purge checks
  `git merge-base` before reading any count, and falls back to comparing trees.

The rule underneath all three: only a file that exists on the branch and
nowhere on the default branch can actually be lost. Everything else is the
default branch having moved on.

## The Pull Request Template

`/git:pr` takes the first of: `.github/pull_request_template.md` (or the same
name under `docs/` or the repository root), a named template from
`.github/PULL_REQUEST_TEMPLATE/`, then
[templates/pull_request_template.md](templates/pull_request_template.md) here.

The default is deliberately tracker-agnostic. It carries a `Closes [PROJ-xxx]`
line under **Summary**, and says plainly what that does: against a GitHub issue
`Closes #123` closes it on merge, while against an external work item management
system (Jira, Monday.com, or anything else), `Closes [PROJ-123]` is a human
convention that closes nothing on its own. Repositories with no tracker delete
the line and link the plan document instead.

Its sections are In short, Summary, Change Type, Delivered, Decisions, Testing
Evidence, and Validations Passed. The evidence table asks for one row per
evidence base with the command and what it said, because "tests pass" is not
evidence. `Stacked on #N` belongs under Summary when the branch is a stack
layer.

## The Stack Guard

Two open pull requests against the same base are reviewed as though neither
existed. The second one's diff carries the first one's changes, or conflicts
with them, and the reviewer cannot tell which is which. [Stacked pull
requests](https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests)
make the dependency explicit: the second targets the first's branch, so its diff
is only its own work.

The guard is a `PreToolUse` hook on `Bash`. It fires on `gh pr create`, and
blocks when all of the following hold:

- the pull request would target the repository's default branch: an explicit
  `--base` naming something else is already a stack, and passes;
- you have at least one open pull request of your own against that branch.

It never fires on `gh stack submit`, which opens its pull requests through the
extension, so the guard that asks for stacking never blocks stacking.

### What It Says

```text
Blocked: you already have an open pull request against main.

  #19  agent handover contract and /wrap:handover skill  [feat/agent-handover-pattern]

A second pull request against main is reviewed as though the first
did not exist — its diff carries the other's changes or conflicts with them.
It touches 2 of the same file(s), so it very likely belongs on top.

Stack this work on top instead:

  gh stack init feat/agent-handover-pattern      # once, if #19 is not a stack yet
  gh stack add <this-branch>
  gh stack submit --auto
```

The "same file(s)" line is best effort: it compares this branch's diff against
the open pull request's files, and is left out when either cannot be read. It
changes the wording, never the verdict.

### The Escape

Concurrent work is not always dependent work. An urgent fix in an unrelated area
while a feature sits in review belongs on the default branch, not on top of that
feature. Prefix the command to say so:

```bash
STACK_OK=1 gh pr create --title "..." --body "..."
```

It is read from the command text, not the environment, because the hook is a
separate process and never sees a variable exported for `gh` alone. That it has
to be typed is the point: the default answer is "stack it", and overriding is a
decision you make rather than a setting you forget.

### Prerequisites

Neither is checked before the guard redirects you, so set both up first:

```bash
gh extension install github/gh-stack
```

and enable stacked pull requests on the repository (**Settings > General > Pull
Requests**). The extension exits `9` without it, and that setting is not exposed
on the repository API, so the hook cannot warn you in advance.

`gh stack` is an official extension, not built into `gh`. Its commands are
`init`, `add`, `view`, `submit`, `push`, and `sync`, not `gh pr create`. The
extension ships [its own
skill](https://github.com/github/gh-stack/blob/main/skills/gh-stack/SKILL.md),
which is worth installing alongside this: it teaches the workflow, this hook
enforces reaching for it.

Stacks are strictly linear: one parent, at most one child.

### It Fails Open

No `gh`, no network, not a GitHub repository, an unreadable payload, `jq`
missing: every one of those exits 0 and lets the command through. A guard that
blocks pull requests when it cannot reach GitHub is worse than no guard.

### What It Does Not Cover

This is a [soft control](../../docs/controls.md): it sees the agent's `Bash`
calls and nothing else. Your own terminal, the GitHub web UI, and
a GitHub MCP server all bypass it. Binding yourself as well needs a `gh` wrapper
or a shell alias, which is a separate decision.

Shell is not reliably parseable either. The match covers the ordinary forms; a
command assembled in a variable, or run through an alias, will get past it.
