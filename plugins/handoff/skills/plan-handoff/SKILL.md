---
name: plan-handoff
description: >
  Package planning and architecture work into a dispatch folder (docs/handoff/) that a fresh
  Claude Code session can execute without the planning conversation. Use this skill whenever the
  user wants to hand work over to Claude Code, prepare a day plan or QA plan, write ticket briefs,
  dispatch implementation work, or says things like "hand this over", "prepare the handoff",
  "write today's plan", "brief this for implementation", "package this for Claude Code", or shares
  a scope/QA document and asks how to organise the work. Also use it at the end of a planning or
  architecture session when the natural next step is implementation in another session.
argument-hint: [scope document, notes, or ticket list]
user-invocable: true
---

# Plan-to-Implementation Handoff

Planning happens in one session (Claude Desktop / Cowork, plan mode); implementation happens in
another (Claude Code) with zero shared context. This skill turns planning output into committed
dispatch documents the implementation session can execute alone. The core insight: the brief is
the only channel, so anything not written down is lost. Fixture IDs, gotchas, already-done work,
and failure interpretation all belong in the brief, not in your head.

The operating model behind this skill (why planning and implementation run on separate
instances) is described in the ai-toolkit practices doc `practices/planning-handoff.md`.

## Step 0: Defer to the Repo Contract

Before writing anything, check the target repository for an existing contract:

1. `.claude/rules/handoff.md` (the canonical location)
2. An existing `docs/handoff/` with a README

If either exists, follow it exactly; it overrides the defaults below. If neither exists, use the
defaults below and offer to create the rule file so the contract survives for future sessions
(copy the Contract Defaults section into `.claude/rules/handoff.md` with a `paths:
["docs/handoff/**"]` frontmatter).

Also read the repo's prose and markdown rules (`.claude/rules/prose-style.md`, `markdown.md`, or
equivalent) and apply them. Regulated repos often ban em dashes, require breadcrumbs, or enforce
heading case; a handoff PR that violates repo conventions wastes a review round-trip.

## Contract Defaults

### Layout

```text
docs/handoff/
  README.md                      Index and flow description
  YYYY-MM-DD/                    One folder per dispatch day
    00-day-plan.md               Ordering, gates, and ticket handling for the day
    {ticket-key}-{slug}.md       One self-contained brief per work unit
```

One brief maps to one work unit: one branch, one PR, per the repo's branch conventions. A brief
may cover several tickets when they form a single connected run that would be artificial to split;
name every ticket in the brief header. Prefer fewer, connected briefs over many fragmented ones:
each separate brief forces a fresh session to re-establish context.

### Status Lifecycle

Every document starts with a status header:

```markdown
> **Status:** Dispatched | **Date:** YYYY-MM-DD | **Author:** planning session | **Tickets:** PROJ-123
```

Statuses: Draft (being written), Dispatched (ready to execute), Consumed (executed, Outcome
filled), Archived (history only, may be stale). Never move to Consumed with an empty Outcome.
When creating a new day folder, roll still-Dispatched briefs forward or mark them Archived.

### Brief Format

Required sections, in order:

1. **Status header**, as above.
2. **Context**: why the work exists and what it gates. Two paragraphs maximum.
3. **Already done, do not redo**: merged PRs, deployed changes, fixes the tracker may not yet
   reflect. This section prevents the most expensive failure mode: a fresh session re-implementing
   finished work.
4. **Steps**: ordered, concrete, with expected results. Inline every identifier the reader needs
   (page IDs, ticket keys, URLs, file paths); the reader has no other source.
5. **Failure interpretation**: how to tell a fixture or environment problem from a code defect,
   where known in advance. This is what stops a session from "fixing" working code against a
   broken fixture.
6. **Outcome**: empty at dispatch. The implementation session fills it: date, observations,
   evidence links (PR, ticket comment), deviations from the steps.

### Staleness

Committed handoff documents outlive their accuracy. All session state in a brief (PR states,
deployment states, credential or connector status) is a snapshot from the header date. The
implementation session verifies PR and deployment state directly before trusting it. Write briefs
in third person ("the planning session could not verify X"), never first person; the document
outlives the session that wrote it.

### Evidence Promotion

The brief is the dispatch record, not the audit record. Durable evidence is promoted out: a
comment per ticket in the tracker (date, fixture IDs, observed outputs), and formally shaped test
notes where a qualification process exists. Do not close tickets whose closure requires a separate
evidence process (in regulated repositories, stories may close only on formal test evidence;
functional verification today, formal evidence pass later). Shape verification notes as
given/when/then so a later formal write-up can lift them directly.

## Authoring Workflow (Planning Session)

1. Read the repo contract and conventions (Step 0).
2. Identify the work units: what can a session pick up and finish independently? Gates and
   observability checks get their own briefs; connected verification runs share one.
3. Write `00-day-plan.md`: goal, fixtures, dependency spine, ordering table pointing at each
   brief, ticket-handling rules for the day, and a numbered gaps-and-risks list with explicit
   confidence levels (planning sessions know what they could not verify; say so).
4. Write each brief with all six sections. Test each one mentally: could a session with no other
   context execute this? If it needs the conversation, the brief is incomplete.
5. Commit on a ticket-keyed branch per the repo's branch conventions. Leave signing and pushing
   to the operator if the environment cannot sign commits.
6. Tell the operator the exact entry point, for example: "point Claude Code at
   `docs/handoff/2026-01-15/proj-123-gate-check.md`".

## Consuming Workflow (Implementation Session)

1. Read the day plan first for ordering and gates, then the assigned brief.
2. Verify all session-state claims (PR state, deployments) before acting on them.
3. Respect "Already done, do not redo" absolutely; verify rather than re-implement.
4. Work the brief on its own branch and PR per repo conventions.
5. Fill the Outcome section and set Status to Consumed in the same PR as the work, or a follow-up
   commit. Promote evidence to the tracker per the contract.
6. If a hard gate fails (a blocking dependency is not deployed), stop, record the finding in
   Outcome, and surface it to the operator rather than improvising around the gate.
