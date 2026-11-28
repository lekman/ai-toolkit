# Goals and Specifications

[ai-toolkit](../../README.md) / [Practices](../README.md) / [Engineering with Agents](README.md)

Start every piece of work from a business goal, describe the wanted behaviour
as scenarios, and plan the stages before any agent writes code.

## The Practice

### Name the Goal and Its Measure

A goal says who benefits, what changes for them, and how you will know. "Add
an export button" is a task. "A finance user closes the month without asking
engineering for a data extract, measured by extract requests per month" is a
goal. An agent given the task builds a button. An agent given the goal, and
the scenarios below, can be held to an outcome.

### Write Behaviour as Scenarios

Behaviour-driven development (BDD) describes software by what a user can
observe. Each scenario has three parts: a starting state (Given), an action
(When) and a result (Then).

```gherkin
Scenario: A finance user exports a closed month
  Given the month of March is closed
  When the user exports March as CSV
  Then the file holds one row per posted transaction
  And the totals match the ledger
```

Write a scenario for the case that must fail as well as the one that must
pass. "A user without the finance role cannot export" is as much a part of
the specification as the export itself.

Scenarios that a machine runs belong in the repository as tests. They are
executable, so they cannot drift from the code without failing.

### Plan the Stages

A plan that stops at "it works" delivers a prototype. Plan all six stages, and
decide the evidence for each before the work starts.

| Stage              | The question it answers                      | Evidence                                   |
| ------------------ | -------------------------------------------- | ------------------------------------------ |
| Achieve            | Does it do the thing at all?                 | The main scenario passes                   |
| Test               | Does it do the thing every time?             | All scenarios pass, positive and negative  |
| Harden             | What happens when input or load is hostile?  | Security checks, failure cases, limits     |
| Make efficient     | What does it cost to run?                    | Measured time, memory and spend            |
| Evaluate           | Did we build what the goal asked for?        | Review against the goal by a second person |
| Measure the impact | Is anyone using it, and did the number move? | The goal's measure, read after release     |

Small work passes through several stages in an hour. The table still applies,
because it stops the work being called done at the first row.

## Why

An agent optimises for the instruction it was given. With no specification,
the instruction is the last message in the chat, and "done" means whatever
the agent last believed. A written goal and scenarios give the agent a target
it can test against, and they give the reviewer something to hold the result
to.

The plan also lets the work be split. Each scenario or stage can go to a
separate session, because the specification carries the context that the
chat would otherwise hold. See
[Sessions and Subagents](sessions-and-subagents.md).

## The Failure It Prevents

- Work that passes its own tests and misses the purpose.
- A feature that is finished and never used, with nobody checking.
- A long session whose only record of the requirement is the conversation.

## How It Is Enforced

- The plan and its status live with the notes and the tracker, outside the
  repository. In this toolkit the [Planner](../../plugins/planner/README.md)
  plugin writes the acceptance criteria and a test plan before execution, and
  refuses to execute without them.
- Each row of the test plan names the artefact that proves it, such as a test
  report or a captured response. "The agent said it passed" is not an
  artefact.
- The scenarios run in continuous integration (CI), so a pull request that
  breaks one cannot merge.
