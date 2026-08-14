<!-- markdownlint-disable-file MD041 -->
<!--
PR conventions for ai-toolkit:
- Title is a Conventional Commit subject: type(scope): description. No ticket prefix.
- Keep it short. Reviewers skim. Long prose gets skipped.
- This repo is public. Never paste client names, vault contents, calendar URLs,
  or anything else that identifies a client engagement. Generalise it first.
- Replace the italic guidance below; delete any section that does not apply.
-->

> **In short:** _One or two plain-language sentences: what was broken, why it
> matters, and what this PR does at a high level._

## Summary

_What and why, in one or two sentences._

<!--
`Closes #123` closes a GitHub issue on merge. Delete the line if this PR does
not close one, and link the plan or practice doc instead.
-->

Closes #

<!-- If this PR is stacked, add a line: Stacked on #N -->

## Change Type

<!-- Tick all that apply. -->

- [ ] Feature
- [ ] Fix
- [ ] Refactor / chore
- [ ] Docs only
- [ ] Infra / CI

## Delivered

<!-- Bullet the concrete changes: file paths, skills or packages added or removed. -->

-

## Decisions

<!-- Numbered, each a bold headline plus a one-sentence rationale, framed as decided. -->

1.

## Testing Evidence

<!--
One row per evidence base in scope.
Status legend: 🟢 passed · 🟡 deferred · ⚪ out of scope / manual testing required.
A skill or prompt change is tested by running it and showing what it did.
"The wording is clearer" is not evidence.
-->

| What to test         | How (evidence base) | Surface   | Status | Evidence                     |
| -------------------- | ------------------- | --------- | ------ | ---------------------------- |
| _behaviour under_    | Unit                | packages/ | 🟢     | `bun test` pass              |
| _the skill actually_ | Manual run          | vault     | 🟢     | _what it changed, and where_ |
| _formatting_         | Static              | repo      | 🟢     | `bun run lint` clean         |

<!--
This repo's client is not under a regulatory standard, so the default
template's "Regulatory impact" section is deliberately absent. See
plugins/git/skills/pr/SKILL.md step 1b for when it applies.
-->

## Intended Use Verification

<!--
Delete for trivial changes. Add when step-by-step manual verification helps a
reviewer confirm the change does what it intends: prerequisites, the exact
steps, and the expected observation at each step.
-->

## Validations Passed

<!-- Completed checks, not tasks for the reviewer. -->

- [ ] `bun run lint` clean
- [ ] `bun run typecheck` clean
- [ ] `bun run build` succeeds
- [ ] `trunk check` clean (prettier formats markdown too)
- [ ] No client-identifying content in the diff
