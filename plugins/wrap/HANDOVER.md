# The Handover Contract

One shape for every handover, whichever skill writes it. A handover is read by
an agent that was not in the conversation that produced it: a fresh Claude Code
run, a session on another machine, an isolated or containerised agent, or you in
a week. It has to stand alone.

A task list says _what_ is left. A handover says **what will bite you**. That is
the whole difference, and it is why the constraints come before the tasks.

## Audience Rule

Write for someone with zero context.

- No "as discussed", no "the issue from earlier", no pronoun pointing at the
  conversation.
- Every claim states **whether it was verified and when**. If something is
  unverified, say so: "not checked since `<date>`" is useful; a smooth sentence
  that hides it is not.
- Name files, branches, commands, and identifiers in full. The reader cannot ask
  a follow-up question.

## Sections

Use these in this order. Drop a section only when it is genuinely empty, and
prefer writing "None" to deleting it: an absent section reads as _forgotten_,
"None" reads as _checked_.

### Frontmatter and Title

```markdown
---
type: handover
client: <Client>
status: active
tags: [handover, agent-task]
created: <YYYY-MM-DD>
---

# Handover — <topic>, <Day> <D> <Mon> <YYYY>

**Audience: an agent picking this up cold.** You do not need the conversation
that produced it. Everything below was verified live on <date> unless marked
otherwise; where something is unverified it says so.
```

### The Goal

Two or three sentences. What state the work should be in when the receiving
agent is done, and what is already true. Not a narrative of how it got here.

### Hard Constraints: Read Before You Touch Anything

A numbered list, before any task. This is the section that saves hours.

Cover, where they apply:

- **Freezes and safe zones**: which environments may be touched today, which
  may not, and why the tasks below are safe under that rule.
- **What deploys where automatically**, and what does not. A change that lands
  in one environment on merge and never reaches another is a constraint, not a
  detail.
- **The traps that make a wrong answer look right.** These are the expensive
  ones because nothing fails:
  - a green check that proves nothing (a step running with
    `continue-on-error`, a job that reports success on a non-zero exit);
  - stale state in a dependency you did not touch (caches, lockfiles,
    generated files);
  - a pipeline that applies silently to nothing (an empty job matrix, a path
    filter that never matches, a directory with no deployment wired up at all).

Say what to _do_ about each, not just that it exists.

### Access

Named profiles, roles, and which is read-only versus write. Mark the ones that
must not be used today and why. How to refresh an expired session.

**Never put credentials, tokens, or secret values in a handover.** Profile
names, role names, and account identifiers only.

### Tasks, in Order

One `## Task N — <what>` heading each, ordered so the reader can go top to
bottom. Each task carries:

- **Why**: the observed state that makes this necessary, with its verification
  date. "The service has no queue configuration at all: verified `<date>`, the
  task definition's environment has no `<VAR>`" beats "configure the queues".
- **What and where**: the exact file, block, and roughly the line.
- **The trap, if the obvious implementation is wrong.** If you know the first
  approach a competent agent will reach for and it has a problem, say so before
  they write it, and give the alternatives in order of preference with the
  trade-off named. Recommend one.
- **Verify before applying**: the command, and _what a correct result looks
  like_. Bound it: "expect only X to change; anything touching Y is not
  expected; stop and read."
- **Confirm it is actually live**: a separate command against the running
  system. Registered is not deployed; merged is not applied; planned is not
  running.

"Apply this" is not a task. "Apply this, expect exactly these resources to
change, then confirm with this call that it is actually running" is.

Gate anything irreversible or outward-facing (a new running service, an
external send, a production touch, a destructive migration) as **needs an
operator decision**, with the reason. An agent with no context will otherwise
reasonably assume it is in scope.

### Done Already: Do Not Redo

What is finished, with the evidence and the date. This is what stops the
receiving agent from spending its first hour re-proving your last hour. Link the
PRs and name the tests.

### Known-Wrong Things That Were Corrected: Do Not Re-Derive Them

Beliefs held earlier in the work that turned out to be false, each with the
correction and _why the wrong conclusion was reachable_. A corrected mistake is
more useful to the next agent than a clean record: without it they follow the
same reasoning to the same wrong place.

### Open Findings: Do Not Fix Unilaterally

Things discovered but deliberately not fixed: a latent bug, a decision that is
not the agent's to make, a safeguard that the naming implies but the code does
not have. Give the risk today and what pins the current behaviour (a test, a
comment). Under its own heading, so it is neither lost nor silently actioned.

Keep this separate from the tasks. Anything in the task list will be done.

### Blocked Externally: Not Schedulable

What is waiting on someone outside the work, what was asked, when, and what can
and cannot be proven until it arrives.

### Reference

The durable notes (master plans), the design documents, and the specific files
worth reading. Say what each one is for.

## Where a Handover Lives

**In the vault, and only there.**
`Clients/<Client>/Handover — <topic>, <Day> <D> <Mon> <YYYY>.md`, or
`Personal/Handover — …` for non-client work.

- Handover notes are indexed for retrieval, so an agent with vault access can
  find one by searching for the topic without being given the path.
- Link it from the dashboard's current day, under that client's heading, as a
  `> [!abstract]` callout directly below the intention or overview note. A
  handover nobody can find is a handover nobody reads.
- Do **not** write a copy into a repository. Two copies drift the moment one is
  edited, and the vault copy is the one the next agent will search.

An agent that cannot reach the vault (a containerised or isolated run, a
hosted session) gets the content pasted to it. That is a transport problem, not
a reason for a second file.

## Relationship to the Session Handover

`/wrap:session` writes `.tmp/session-handover.md`: repo-local, one-shot,
injected by the plugin's `SessionStart` hook and archived on pickup. Different
job: it carries **learnings and codification recommendations** to the next
session in _this_ repo on _this_ machine.

Use a vault handover when the work moves to a different agent, a different
machine, or a different day. Use both when both are true; they do not overlap.
