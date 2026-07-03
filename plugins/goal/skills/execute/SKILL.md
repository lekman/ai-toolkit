---
name: execute
description: Execute an approved goal autonomously. Read the Test Plan (Definition of Done) from the plan document, iterate independently until every evidence base is green through the deployed system, then open the PR and run the validation gates. Plan the goal first with /goal:plan. Use for "execute the goal", "drive this to done".
---

# Goal Execute (the execute + report phases)

Drive an already-approved goal to a **validated** result, autonomously. The
Definition of Done is the `## Test Plan` in the ticket's plan document, written
and approved via [`/goal:plan`](../plan/SKILL.md).

If there is no approved Test Plan for this work, **stop and tell the operator
to run `/goal:plan` first.** This skill executes a plan; it does not invent
one.

## Operating principle: agentic independence

The division of labour is fixed:

- **The operator owns the _what_ and the _what proves it_**, already captured
  as the acceptance criteria and Test Plan by `/goal:plan`. They do not direct
  the steps.
- **The agent owns the _how_ and the execution.** It works independently to
  reach the validated result as fast as possible, delegating to subagents
  wherever independent surfaces or fixes run in parallel (see Delegation). It
  does not stop to ask permission between iterations.

The skill runs **autonomously and iteratively**, stopping only when:

1. **Validated**: every evidence base in the Test Plan is green through the
   layered guards below.
2. **Blocked**: the agent cannot progress without an operator decision or an
   external change (a missing permission, an unavailable credential, an
   ambiguous requirement, a third-party outage). A failing test is **not** a
   blocker; it is the next thing to fix.

When blocked, stop, record the blocker in the Test Plan, and surface it. Do
not loop forever; do not silently give up.

## Quality is layered, and the last layer runs against the deployment

A result is _validated_ only when it has passed every guard, in order:

1. **Definition of Done / acceptance criteria / Test Plan**: the contract
   (from `/goal:plan`).
2. **Pre-commit hooks and guards**: commit message lint, secrets scanning,
   supply-chain checks. Pass before the commit lands.
3. **CI gates**: lint, type check, unit + coverage, security and quality
   gates. Green before merge.
4. **CD pipeline**: the deploy succeeds.
5. **End-to-end checks against the deployed system**: the running system is
   exercised and proves it works (negative + positive). The final word: no
   deployed pass, not validated.

The report phase is not complete until the deployed checks are green.

## Delegation

Use subagents to reach the validated result faster, not for its own sake. Good
cuts: run independent evidence bases in parallel (lint, type check, unit on
different packages at once); fan out fixes for unrelated failures. Keep the
Test Plan and the commit history single-threaded (the main agent owns them) so
the record stays coherent.

## Execute phase

Loop until validated or blocked. Each iteration:

1. Pick the lowest unmet row in the Test Plan. Work base-up: static before
   unit before integration before deployed.
2. Run that evidence base.
3. Passes: mark the row `green`, record the evidence artifact (the command +
   observed result, or the path to the evidence file), continue.
4. Fails: fix the cause (smallest correct change), re-run. A fix may add or
   change rows. Keep the Test Plan current.
5. Cannot progress without an operator decision or external change: mark the
   row `blocked`, record why, stop.

Rules:

- **Commit as you go**, conventional-commit style, referencing the ticket.
  **Do not push** until the report phase, so bot re-reviews do not duplicate.
- **Keep the Test Plan in sync** after every iteration. It is the live record.
- **Negative + positive both green** before a security or correctness claim
  counts.
- **No silent caps.** If a check is skipped (for example a deployed check
  while the deploy is gated), say so in the Status (`blocked`) with the
  reason.

## Report phase

Only when every Test Plan row is `green`:

1. **Push** the branch.
2. **Open the PR** against the repo's pull request template; copy the
   `## Test Plan` table into the testing-evidence section. Reference the
   ticket so the project management system links it.
3. **Run the gates**: drive CI green and triage automated review comments to
   steady state.
4. **Alert the operator** (the one operator touchpoint in this skill): the PR
   is ready for human review. State the PR number, the green Definition of
   Done, and anything left for the human (for example intended-use UI testing
   the operator owns).

## Separation of duties

This skill's goal is to complete the work. Verifying that the goal plan was
met belongs to a different identity: a reviewer account (for example a
dedicated QA login) that reviews the PR, approves only the change types it is
scoped to, and steers the executing agent back when a CI, security, or QA
issue is found. The reviewer cannot change its own policies or rule systems.
Two agents, two goals, and the plan document is the contract between them.

## Failure modes

- **No approved Test Plan**: stop; tell the operator to run `/goal:plan`.
- **No ticket resolvable**: ask for the ticket reference; do not invent one.
- **Blocked mid-execution**: stop, record the blocker in the Test Plan,
  surface it. Resume on a later invocation once it clears.
- **A deployed evidence base needs a gated deploy**: mark those rows `blocked`
  on the gate, finish every other row, surface the gate as the single
  remaining blocker rather than looping.
