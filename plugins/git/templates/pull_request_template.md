<!-- markdownlint-disable-file MD041 -->
<!--
PR conventions:
- Title is a Conventional Commit subject: type(scope): description. No ticket prefix.
- Keep it short. Reviewers skim. Long prose gets skipped.
- Link the work item by id and the design/plan doc by path. The work item
  management system may be Jira, Monday.com, GitHub Issues, or none; name it
  the way this repo names it, and if there is none, link the plan doc instead.
- Replace the italic guidance below; delete any section that does not apply.
-->

> **In short:** _One or two plain-language sentences: what was broken, why it
> matters, and what this PR does at a high level. If it both fixes something now
> and builds a reusable mechanism, say so._

## Summary

_What and why, in one or two sentences._

<!--
Reference the work item. `Closes` is a GitHub closing keyword: against an issue
(`Closes #123`) it closes it on merge; against an external tracker
(`Closes [PROJ-123]`) it is a human convention and closes nothing on its own.
Delete the line if this repo has no tracker, and link the plan doc instead.
-->

Closes [PROJ-xxx]

<!-- Link the design/plan doc, e.g.: Design: docs/design/<name>.md -->
<!-- If this PR is stacked, add a line: Stacked on #N -->

## Change Type

<!-- Tick all that apply. -->

- [ ] Feature
- [ ] Fix
- [ ] Refactor / chore
- [ ] Docs only
- [ ] Infra / CI

## Delivered

<!-- Bullet the concrete changes: file paths, resources added or removed. -->

-

## Decisions

<!-- Numbered, each a bold headline plus a one-sentence rationale, framed as decided. -->

1.

<!--
REGULATED CLIENTS ONLY: delete this whole section when the client this repo
belongs to has no entry in the `regulatory` map of ~/.claude/obsidian.json.
An unregulated repo carrying an unanswered risk question reads as an
unfinished PR, not as diligence.
-->

## Regulatory Impact

**Does this change affect a regulated process or the data it produces?**

- [ ] No
- [ ] Yes: complete the risk assessment below

_Apply this repository's regulated / not-regulated label to match the answer;
the label is what the reviewer and any audit read, not this checkbox. Changes
that cannot reach the runtime artefact (documentation, agent configuration)
are normally out of scope, but say so rather than leaving it implied._

### Risk Assessment _(Required When the Answer Is Yes)_

**What could go wrong?**

<!-- Failure modes and how likely each is. -->

**Risk level:** Low / Medium / High

**Mitigation:**

<!-- What control keeps the risk acceptable. -->

## Testing Evidence

<!--
One row per evidence base in scope.
Status legend: 🟢 passed · 🟡 deferred · ⚪ out of scope / manual testing required.
Replace the example rows with this repo's own commands.
-->

| What to test           | How (evidence base) | Surface | Status | Evidence               |
| ---------------------- | ------------------- | ------- | ------ | ---------------------- |
| _behaviour under test_ | Unit                | src/    | 🟢     | `<test command>` pass  |
| _formatting + hygiene_ | Static              | repo    | 🟢     | `<lint command>` clean |

### Deferred Verification

<!--
Delete unless a row above is 🟡 or ⚪ because its proof depends on future work:
a follow-on PR, a deployed test needing an environment this PR does not stand
up, or an evidence base that lands later. A deferred row is not a failure.

Per deferred row: what is proven now, what is still to come, and where it lands
(the follow-on PR, ticket, or plan row that carries it).
-->

## Intended Use Verification

<!--
Delete for trivial changes. Add when step-by-step manual verification helps a
reviewer confirm the change does what it intends: prerequisites, the exact
steps, and the expected observation at each step.
-->

## Validations Passed

<!-- Completed checks, not tasks for the reviewer. -->

- [ ] `<lint command>` clean
- [ ] `<test command>` pass
- [ ] `<typecheck command>` clean
- [ ] Change is traceable to a work item, or the plan doc is linked
- [ ] Commit messages follow Conventional Commits
- [ ] No secrets, personal data, or client-identifying content in the diff
