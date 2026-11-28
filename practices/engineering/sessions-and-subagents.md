# Sessions and Subagents

[ai-toolkit](../../README.md) / [Practices](../README.md) / [Engineering with Agents](README.md)

Keep each session short, hand work over through the specification, let
subagents work in separate worktrees, and deliver one change a person can
review.

## The Practice

### Keep Sessions Short

A session is one conversation with an agent. Everything in it is sent again
on every turn, so a long session costs more per turn and holds its early
detail less well. End a session when its unit of work is done, and start the
next one from the specification. [Context](../context/README.md) covers the
settings and habits that keep a session small.

A session that needs its own history to continue is a sign that something
belongs in the specification and is missing from it.

### Make the Specification the Handoff

Work moves between sessions, and between an orchestrating session and its
subagents, through the written specification. A subagent is a separate agent
that the main session starts for one task. It receives the scenarios it must
satisfy, the files it may touch, and what done looks like. See
[Goals and Specifications](goals-and-specs.md).

Test a handoff with one question. Could a session with no other context do
this work from the specification alone? If it needs the earlier conversation,
the specification is incomplete.

### Give Each Subagent a Worktree

A Git worktree is a second working folder on its own branch, backed by the
same repository. Give each subagent its own.

- Two subagents that each work in their own folder do not overwrite each
  other's files. A worktree does not stop one from writing outside its
  folder, so the split of the work and the sandbox still matter.
- Each piece of work is a branch that can be inspected, tested and discarded
  alone.
- The main checkout stays clean while the work runs.

Split the work so that no two subagents edit the same files. Work that cannot
be split that way is one task and belongs to one agent.

### Follow Up What You Start

The session that starts another session or a subagent owns it until its work
has landed. Most tools wake the starting session when a piece of work
reports back. None wakes it while that work sits idle, so a finished change
can wait for hours with no commit and no pull request.

Give the starting session a check-in on a clock, such as every 20 minutes.
At each one it lists what it started and sorts each piece as working, done,
waiting on a person or idle. It nudges an idle piece that still has work to
do, and it tells a person after three nudges with no progress. The check-in
ends when nothing is left open.

In the terms of [Always-On Agents](../always-on/README.md), the check-in is
the timers part. Today it lives in the session that set it, so it is lost
when that session ends and is not resumed.

### Deliver Reviewable Pieces

Ten subagents must not produce ten unrelated pull requests for one feature.
The orchestrating session collects the branches and delivers them in a form a
reviewer can read.

- **Small work is one pull request.** The orchestrator merges each subagent's
  branch locally, runs the whole check suite on the result, and opens a
  single pull request.
- **Large work is a stack.** A stack is a chain of pull requests where each
  builds on the one before. Each piece is reviewed alone, and the whole stack
  merges in one operation.

Always build a stack with GitHub's `gh stack` extension, and never by hand
with chained branches. Five commands cover the work.

1. `gh stack init` starts a stack with its first branch, or turns existing
   branches into one.
2. `gh stack add` puts a new branch on top of the stack. Run it once for
   each further piece, after committing the piece below.
3. `gh stack rebase` makes sure each branch holds the tip of the one below
   it. Run it when the stack was made from existing branches, such as the
   branches of subagents that all started from the main branch. Until then
   an upper branch lacks the changes below it, and its checks run against
   an incomplete change.
4. `gh stack submit` pushes every branch and creates the pull requests,
   linked as a stack on GitHub.
5. `gh stack merge` merges the stack as one operation. If any pull request
   in it cannot be merged, none are. Where the base branch uses a merge
   queue, the stack is added to the queue and merges when the queue
   processes it, so do not count on all or nothing there. Merge requirements
   cannot be bypassed for a stack.

The commands are from the help text of version 0.1.0 of the extension. Use
version 0.2.0 or later when subagents work in worktrees. Its release notes
say that from 0.2.0 the extension can adopt and rebase a branch that is
checked out in another worktree. Before that, gather the branches into one
checkout first.

Stacked pull requests were in private preview at that version. The
extension's README says it does not work unless the feature has been enabled
for the repository, and it points to a waiting list. Check that before
planning work as a stack. Where the feature is not enabled, split large work
into pieces that each stand alone, and deliver each as its own small pull
request, merged in order.

The measure for each piece is whether one reviewer, a person or an agent,
can read it whole in one sitting.
[Agent Code Review](code-review/README.md) covers how each piece is reviewed and how
its comments are answered.

### Keep Agent Prose Out of the Repository

| Content                                | Where it lives                                    |
| -------------------------------------- | ------------------------------------------------- |
| What is wanted, and what proves it     | The specification, with the notes and the tracker |
| Progress and status                    | The tracker                                       |
| An engineering decision and its reason | A short decision record, approved by a person     |
| What changed, and how it was verified  | The pull request description, kept short          |
| One agent's notes to another           | A scratch folder that is never committed          |

A pull request description states what changed, why, and what evidence shows
it works. Text written by one agent for another does not belong in it.

## Why

Three costs grow with the number of agents and the length of their runs.

- **Tokens.** Each subagent has its own context, so anything they all read is
  paid for once per agent. Fan out when the tasks are independent, and do the
  work in one session when they are not.
- **Decisions.** A choice made in the middle of a long exchange between
  agents is recorded nowhere a person will look. A short session that ends at
  a specification or a decision record leaves a trace.
- **Review.** A reviewer can take in a few hundred lines with care, and this
  holds for an agent as well as a person. Past that, approval becomes a
  formality, and the checks are the only review left.

Committed handover text has a further cost. The next agent reads it as fact.
If it contains a mistake, the mistake is repeated and built upon, and a
later session may treat it as a rule and refuse correct work.

I have seen these costs in practice and have not measured them across
enough repositories to give numbers. Track tokens per merged change and
review time per pull request in your own work before and after.

## The Failure It Prevents

- An overnight run that took a wrong turn in the first hour.
- A repository where generated plans and handover notes outnumber the code
  changes they describe.
- A pull request too large to read, approved unread.
- Two agents editing the same file and one silently losing its work.
- A finished piece of work that sits uncommitted for hours, because the
  session that asked for it never looked again.

## How It Is Enforced

- The plan lives outside the repository, so there is no plan file to commit.
  The [Planner](../../plugins/planner/README.md) plugin writes it to the
  notes vault.
- List the scratch folder for agent notes in `.gitignore`. This repository
  ignores its local planning folder for the same reason.
- Continuous integration can fail a pull request above a set size, or one
  that adds files under a handover or briefs folder.
- The write guard in [Isolated Agent](../../security/isolated/README.md)
  steers edits into a worktree. It is a hook that can fail open, and a
  worktree only keeps pieces of work apart. What stops a write outside the
  worktree is a sandbox or the file permissions.
- [Orchestrator and Subagents](../orchestrator-subagent.md) adds separate
  credentials for planning and for code.
- The [Sessions](../../standards/SESSIONS.md) standard tells a session to
  schedule the check-in when it starts another one. The schedule fires by
  itself. Acting on it is an instruction the agent follows, and no check
  enforces it.
