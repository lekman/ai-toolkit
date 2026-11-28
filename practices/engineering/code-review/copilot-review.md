# GitHub Copilot Review

[ai-toolkit](../../../README.md) / [Practices](../../README.md) / [Engineering with Agents](../README.md) / [Agent Code Review](README.md)

GitHub Copilot reviews a pull request when a ruleset asks it to. It takes
its instructions from files in the repository, read from the branch under
review.

Tool behaviour on this page is from the vendor's documentation, read on 28
Nov 2026. File names and settings change between releases, so check the linked
pages before you rely on one.

## Set Up

1. Turn on automatic review in a repository or organisation ruleset, so that
   every pull request is reviewed without anyone asking for it. Turn on
   "Review new pushes" in the same ruleset. Without it Copilot does not
   review a new push by itself, and someone has to ask it for a new review.
2. Add `.github/copilot-instructions.md` for rules that apply to the whole
   repository.
3. Add files under `.github/instructions/` for rules that apply to some
   paths. Each file name ends in `.instructions.md` and starts with an
   `applyTo` pattern.

Copilot reads its instructions from the head branch, which is the branch
under review. A pull request can therefore change the rules for its own
review, so treat a change to an instruction file as a change to code. See
[Using GitHub Copilot code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review).

<details>
<summary>A path-specific instruction file</summary>

```markdown
---
applyTo: "**/*.ts,**/*.tsx"
excludeAgent: "cloud-agent"
---

When reviewing, check that every exported function has a test.
Do not comment on formatting. The formatter fails the build on it.
```

The `excludeAgent` line keeps the file for review only. Without it, Copilot's
coding agent reads the file too.

</details>
