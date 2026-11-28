# CodeRabbit

[ai-toolkit](../../../README.md) / [Practices](../../README.md) / [Engineering with Agents](../README.md) / [Agent Code Review](README.md)

CodeRabbit reviews in three places, and one file configures all of them. It
reviews pull requests on GitHub, commits in the editor, and local changes
from the command line or from a coding agent.

Tool behaviour on this page is from the vendor's documentation, read on 28
Nov 2026. File names and settings change between releases, so check the linked
pages before you rely on one.

## Set Up

1. Sign in at CodeRabbit with GitHub as an organisation owner, choose the
   organisation, and select the repositories.
2. Add `.coderabbit.yaml` at the repository root.

```yaml
language: en-GB
tone_instructions: "Be brief. One finding per comment. No praise."
reviews:
  profile: chill
  path_filters:
    - "!**/generated/**"
    - "!**/*.lock"
  path_instructions:
    - path: "src/auth/**"
      instructions: |
        Check that every route validates input and checks authorisation.
  auto_review:
    enabled: true
    drafts: false
    ignore_title_keywords:
      - "release"
```

`profile` sets how much it comments, from `quiet` through `chill` to
`assertive`. `tone_instructions` is limited to 250 characters. See the
[CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration).

A local review sends the changed code to CodeRabbit. Turn automatic review
off in any repository where that is not allowed.

<details>
<summary>Review in the editor</summary>

The VS Code extension reviews without a pull request. Two settings decide
how much of that is automatic. The values below are from version 0.26.2 of
the extension.

| Setting                     | Values                                | What it does                                              |
| --------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `coderabbit.autoReviewMode` | `disabled`, `prompt`, `auto`          | Whether a commit starts a review. The default asks first. |
| `coderabbit.agentType`      | `Claude Code`, `Clipboard` and others | Which coding agent receives a finding from "Fix with AI". |

- **What starts a review.** Any change to the current commit counts,
  including an amend or a rebase. An automatic review covers committed
  changes only, compared with the repository's base branch.
- **What "Fix with AI" does.** With `Claude Code`, the extension opens a
  terminal, runs `claude` with the finding as its prompt, and starts by
  itself. With `Claude Code Extension`, it fills in the prompt and waits for
  you to send it.
- **What it does not do.** The hand-off starts a new agent each time. It
  does not reach an agent session that is already working.

These are user settings, so they apply to every repository you open. Set
`coderabbit.autoReviewMode` to `disabled` in the workspace settings of a
repository whose code must not leave the machine.

</details>

<details>
<summary>Review from the command line or from a coding agent</summary>

The command line tool lets the agent that wrote the code run the review
itself, read the findings and fix them.

```bash
brew install coderabbit
```

```bash
coderabbit auth login
```

```bash
claude plugin install coderabbit@claude-plugins-official
```

The first command installs the tool, the second signs in through the
browser, and the third adds the Claude Code plugin. In a Claude Code session,
`/coderabbit:setup` verifies the setup and `/coderabbit:code-review` runs a
review.

| Option                | Reviews                                                     |
| --------------------- | ----------------------------------------------------------- |
| No option             | Committed, staged and unstaged changes to tracked files     |
| `--committed`         | Committed changes only                                      |
| `--uncommitted`       | Staged and unstaged changes to tracked files                |
| `--include-untracked` | New files as well, where Git does not ignore them           |
| `--base main`         | Changes compared with a named branch                        |
| `--dir <path>`        | One folder                                                  |
| `--agent`             | Any of the above, with findings as one JSON record per line |

- **Limits.** `coderabbit usage` shows how many included reviews are left in
  the rolling hour.
- **What the plugin adds.** Version 1.3.0 holds skills for review, for
  applying pull request feedback and for writing the configuration file. It
  also declares a remote server with a sign-in of its own, which local
  reviews do not need. Its setup text says it has no automatic hook.
- **Before a review.** The plugin's own instructions say to check the
  changes for secrets first, because the diff is sent to CodeRabbit.

This describes version 0.9.7 of the tool. See the
[CodeRabbit command line reference](https://docs.coderabbit.ai/cli/reference).

</details>

<details>
<summary>Settings for every repository</summary>

One repository file is enough for one repository. For settings that should
hold everywhere, CodeRabbit has two places above the repository.

- **Organisation defaults**, set in the CodeRabbit web app.
- **A central repository** named exactly `coderabbit` under the same owner,
  with a `.coderabbit.yaml` at its root.

A repository's own file replaces both by default. To layer it on top, add one
line to the repository's file.

```yaml
inheritance: true
```

With inheritance on, the closer layer wins for each setting and lists are
combined. The repository can then add its own paths and instructions while
the shared language, tone and skip rules stay in one place.

Two points are not settled by the documentation. It does not say that a
local review reads the central repository, only that it layers the
repository file over the organisation's settings. It also does not confirm
that a central repository works under a personal account. See
[Central configuration](https://docs.coderabbit.ai/configuration/central).

</details>

<details>
<summary>Which markdown files it reads as rules</summary>

For pull request reviews, CodeRabbit finds these files by itself and treats
them as guidelines.

- `CLAUDE.md` and `AGENTS.md`, in any folder
- `.github/copilot-instructions.md`
- `.claude/rules/**/*.md`
- `.cursorrules` and `GEMINI.md`

Do not list these under `path_instructions`. That makes CodeRabbit review the
file as content and stops it using the file as a rule. Add other files with
`knowledge_base.code_guidelines.filePatterns`.

The documentation for the command line tool says to pass such files by hand.
A test on this repository showed more than that. A page was written to break
three rules, each stated in one markdown file only, and reviewed with
version 0.9.7.

| Rule broken                          | Stated in                         | Flagged |
| ------------------------------------ | --------------------------------- | ------- |
| A link must point to a file          | A file under `.claude/rules/`     | Yes     |
| No tooling for other vendors' models | The root `CLAUDE.md`              | Yes     |
| No empty modifiers                   | `.github/copilot-instructions.md` | No      |

Both flagged findings quoted the rule they came from. This was one run, so
treat the third row as unproven and not as a limit.

</details>

<details>
<summary>Teaching it from its own comments</summary>

A reply to a CodeRabbit comment that mentions `@coderabbitai` can be kept as
a learning. CodeRabbit then applies it to later reviews.

- Learnings are stored for the Git organisation. The documentation says they
  are not a configuration layer.
- `knowledge_base.learnings.scope` takes `local`, `global` or `auto`. With
  `auto`, a public repository uses its own learnings and a private one uses
  the organisation's.
- Reviews in the editor apply existing learnings. Feedback given in the
  editor does not create one.

A learning is prose that the reviewer may or may not follow. When a learning
is given twice for the same thing, it belongs in a check. See
[Mechanical Checks](../mechanical-checks.md).

</details>

<details>
<summary>Using a review as a gate</summary>

`coderabbit review --gate major` exits with status 2 when a finding is at
that severity or above, so a hook can block on it. Hold off on that until
you have seen how it rates your code.

In the one full review run for this page, covering 27 changed files, all
seven findings were real and all were rated minor. Two of them would have
stopped a reader from following the page at all. A gate set at major would
have passed every one. A gate that depends on an outside service with an
hourly limit can also block work for reasons that have no connection to the
code.

</details>
