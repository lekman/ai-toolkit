# Claude Code Review

[ai-toolkit](../../../README.md) / [Practices](../../README.md) / [Engineering with Agents](../README.md) / [Agent Code Review](README.md)

Claude Code Review is a managed service that reviews pull requests on GitHub.
It takes its instructions from a file named `REVIEW.md`, read from a branch
the pull request cannot change.

Tool behaviour on this page is from the vendor's documentation, read on 28
Nov 2026. File names and settings change between releases, so check the linked
pages before you rely on one.

## Set Up

The service is for Team and Enterprise plans, and it needs no workflow file.

1. An organisation owner turns on Review in the organisation settings on
   claude.ai, connects GitHub, installs the Claude GitHub App and adds the
   repositories.
2. Add `REVIEW.md` at the repository root. It is plain Markdown with no
   schema, so the five answers are written as instructions. The root is the
   only place it is read from as the file for the whole repository.
3. Set "Review runs" for each repository to "Once after PR creation". A
   repository starts at "After every push", which reviews every fix an agent
   pushes. A comment that starts with `@claude review` asks for one more
   review. See
   [Set up Code Review](https://code.claude.com/docs/en/code-review-setup.md).
4. Open a test pull request that is not a draft. A check named Claude Code
   Review appears.

```markdown
# Review Instructions

Do not review pull requests from `release-please--*` or `dependabot/*`.
Do not report formatting, import order or naming. The linter fails on those.
Do not report on generated files under `src/gen/`.
Look closely at anything under `auth/` and at database migrations.
Report at most five nits per review.
```

`REVIEW.md` is read from the base branch or the default branch, and never
from the pull request's own changes. A pull request cannot rewrite the rules
it is reviewed under. Protect the default branch, so that its copy is the
one a review honours. This matters most for a stack, where a piece can
target a branch that no ruleset protects. See
[Code Review customisation](https://code.claude.com/docs/en/code-review-customize.md).

<details>
<summary>Keeping the review file out of the way</summary>

The root is a crowded place, and one more file there is noise for everyone
who opens the repository. The documentation leaves two ways to reduce it.

- **Hide it in the editor.** Add `REVIEW.md` to `files.exclude` in your own
  VS Code user settings. The file stays where the reviewer needs it and
  leaves your file tree. This is a setting on each person's machine, so it
  changes nothing for anyone else.
- **Keep the root file short.** A line of the form
  `@.claude/skills/code-review/SKILL.md` includes a skill file, and that is
  the only kind of subfolder path an include accepts. Move the guidance on
  what to look at closely into the skill. Keep the rules on what to skip and
  the limit on nits in `REVIEW.md` itself. Code Review does not accept
  either of those from an included skill.

Moving the file to `.github/` or `docs/` does not work. A `REVIEW.md` in a
subfolder adds checks for that folder alone, and an include line such as
`@docs/review-rules.md` is ignored.

</details>

<details>
<summary>Without a Team or Enterprise plan</summary>

Run the review from a GitHub Actions workflow with
`anthropics/claude-code-action`. That route takes its instructions from
`CLAUDE.md` and the workflow's prompt. The documentation does not say that it
reads `REVIEW.md`. See
[Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions.md).

</details>
