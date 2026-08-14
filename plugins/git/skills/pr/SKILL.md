---
name: pr
description: Open a pull request using this repository's template, or the plugin's default when the repository has none. Fills the template from the actual diff and commits rather than restating the branch name. Use when the user says "/git:pr", "open a PR", or "raise the pull request".
user-invocable: true
disable-model-invocation: true
allowed-tools: Read, Write, Grep, Glob, Bash, AskUserQuestion
---

# Open a Pull Request

One job: a pull request whose body a reviewer can act on, in the shape this
repository asks for.

## Step 1: Find the Template

First match wins:

1. `.github/pull_request_template.md` (also `PULL_REQUEST_TEMPLATE.md`, and the
   same two names under `docs/` or the repository root; GitHub accepts all of
   them, case-insensitively)
2. `.github/PULL_REQUEST_TEMPLATE/`: a directory of named templates. Ask which
   one with `AskUserQuestion` rather than guessing.
3. The plugin default:
   `${CLAUDE_PLUGIN_ROOT}/templates/pull_request_template.md`

```bash
ls .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md \
   docs/pull_request_template.md pull_request_template.md 2>/dev/null | head -1
```

Say which template you used. A reviewer seeing an unfamiliar shape should be
able to tell whether the repository asked for it or the default supplied it.

## Step 1B: Is This Client's Work Regulated?

The default template carries a **Regulatory impact** section. It applies only
when the client that owns this repository is governed by a standard, so resolve
that before filling the body:

```bash
RESOLVE="<planner-plugin>/scripts/resolve-context.ts"
bun "$RESOLVE" | jq -r '.regulatory | join(", ")'
```

`regulatory` is a list from `~/.claude/obsidian.json`, keyed by client, and is
always present: empty for an unregulated client.

- **Non-empty**: keep the section and answer it. A risk question left
  unanswered on regulated work is worse than one never asked.
- **Empty, or the resolver is unavailable**: **delete the whole section**,
  heading included. An unregulated repository carrying an unanswered risk
  question reads as an unfinished PR, not as diligence.

A repository whose own `.github/pull_request_template.md` already covers this
wins outright: use its wording and its label names, not the default's. Only the
default template is subject to this step.

Read the actual work before writing a word of the body:

```bash
git log --oneline "origin/$(git symbolic-ref -q --short refs/remotes/origin/HEAD | sed 's|^origin/||')..HEAD"
git diff --stat "origin/<default>...HEAD"
```

Then:

- **Every section the template asks for, or delete it.** A heading left with its
  italic guidance underneath is worse than no heading: it reads as unfinished.
- **Testing Evidence is what you ran and what it said**, with the command. Not
  "tests pass". If something was not verified, say so rather than leaving the row
  blank.
- **Never tick a checkbox you did not verify.** Validation lists are completed
  checks, not a to-do list for the reviewer.
- **Work item reference:** fill the tracker id if this repository uses one, and
  delete the line if it does not. `Closes #123` against a GitHub issue closes it
  on merge; `Closes [PROJ-123]` against an external tracker is a human
  convention and closes nothing.
- **If the branch is stacked, say so** (`Stacked on #N`) and describe only
  this layer's work. The base branch carries the rest.

## Step 3: Open It

```bash
gh pr create --title "<conventional commit subject>" --body-file <path>
```

Title is a Conventional Commit subject (`type(scope): description`), no ticket
prefix. Write the body to a file rather than passing it inline; heredocs mangle
backticks and emoji.

The [stack guard](../../hooks/stack-guard.sh) runs on this command. If it blocks,
you already have an open pull request against the default branch: follow its
instructions and stack, or, only when this work is genuinely independent, re-run
with the `STACK_OK=1` prefix it names.

## Step 4: Report

The URL, the template used, and anything you left unverified in the body.

## Constraints

- Never open a pull request from the default branch.
- Never invent evidence. An unrun command is not a passing check.
- Do not push or merge unless asked: this skill opens a pull request.
