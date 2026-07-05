---
name: plan
description: Plan a goal before any execution. Derive the acceptance criteria and Definition of Done, write them as a Test Plan in a markdown plan document, and refine them with the operator until approved. Hands off to /goal:execute for autonomous execution. Use for "plan this goal", "set the acceptance criteria", "what's the definition of done".
---

# Goal Plan (the plan phase)

Turn a goal into a written, agreed Definition of Done **before** any execution.
This is the interactive half of the workflow: the operator owns the acceptance
criteria and the evidence that counts as proof; this skill captures and
sharpens them with the operator, then hands off to
[`/goal:execute`](../execute/SKILL.md).

This skill **does not write source code or run tests**. It produces and refines
a plan. Execution is `/goal:execute`'s job.

## Why plan first

The division of labour between operator and agent only works when the contract
is written down before the agent starts. Two agents can then hold each other to
it: one executes toward the plan, another (for example a QA reviewer account)
verifies the plan was met. Without a written plan, "done" is whatever the
executing agent last believed, and there is nothing to steer back to.

## What it produces

A `## Test Plan` section in the ticket's plan document, a markdown file under
the repo's plans directory (for example `docs/plans/tasks/<ticket>-<slug>.md`),
holding:

- **Acceptance Criteria**: what "done" means, in the operator's words.
- **Test Plan table**: one row per evidence base in scope:

```markdown
## Test Plan

| What to test | How (evidence base) | Surface   | Status      | Evidence                   |
| ------------ | ------------------- | --------- | ----------- | -------------------------- |
| <claim>      | Linting             | <package> | not-started | linter clean               |
| <claim>      | E2E (negative)      | deployed  | not-started | no-auth call rejected, log |
| <claim>      | E2E (positive)      | deployed  | not-started | authed call succeeds, log  |
```

Every security or correctness claim needs **both** a negative and a positive
row. Status starts `not-started`. The Evidence column names the **artifact that
proves it** (a test report, a captured response, a coverage file), not a proxy
like "the container ran".

## Steps

1. **Identify the goal and the ticket.** From the argument, the branch name, or
   ask the operator. The ticket lives in whatever project management system the
   repo uses (Jira, Monday, GitHub Issues); the plan document references it.
2. **Derive the candidate Definition of Done.** List the surfaces the work
   touches (libraries, services, infrastructure, the deployed system, the user
   journey) and the evidence base each needs. A deployed-service change needs
   static checks + unit + integration + end-to-end against the deployment; a
   user-facing flow also needs intended-use verification.
3. **Write the AC + Test Plan** into the ticket's plan document. Create it if
   absent, with sections: Status, Scope, Acceptance Criteria, Test Plan,
   Captured Evidence, Blockers, Follow-ups.
4. **Show it and refine, interactively.** Open the plan so the operator reads
   it in their editor, then iterate: adjust the acceptance criteria, tighten
   the evidence definition, add or remove rows. Loop with the operator until
   they agree. This is the only place the operator and the plan converge; take
   the time here.
5. **Get the explicit OK, then hand off.** On approval, tell the operator to
   run `/goal:execute` to execute autonomously. **Do not start executing
   here.**

## The operator's role

State the acceptance criteria and what evidence proves execution, not the
steps. This skill captures and sharpens those. `/goal:execute` then reaches
them independently.

## Boundary

- This skill stops at an **approved Test Plan**. It never edits source or runs
  tests.
- `/goal:execute` reads the Test Plan this skill produced and drives it to
  validated (through pre-commit, CI, CD, and deployed verification).
