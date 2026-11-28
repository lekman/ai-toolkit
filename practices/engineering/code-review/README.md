# Agent Code Review

[ai-toolkit](../../../README.md) / [Practices](../../README.md) / [Engineering with Agents](../README.md)

Reviewer agents read every pull request, and on many repositories no person
does. Give each reviewer its own instructions, answer every comment it
leaves, resolve the threads, and let the risk of the change decide who
approves.

Tool behaviour on this page is from each vendor's documentation, read on 28
Nov 2026. File names and settings change between releases, so check the linked
pages before you rely on one.

## Workflow

![Review workflow](review-workflow.svg)

<details>
<summary>The steps in detail</summary>

1. **Instructions.** A person writes one instruction file for each reviewer.
   It says what to skip, what a check already enforces, where to look
   closely, how deep to go and how to write. A change to it is reviewed like
   a change to code.
2. **Local review.** The coding agent runs a reviewer on its own work before
   the pull request opens, fixes what is real, and runs it once more. It
   stops after two rounds.
3. **Reviewers comment.** The work arrives as one pull request, or as a
   stack where each piece is reviewed alone. Every reviewer reads it under
   its own instructions. See
   [Sessions and Subagents](../sessions-and-subagents.md) for stacks.
4. **Answer comments.** Each comment gets one reply in its own thread, as
   fixed, declined or deferred. A reviewer reads the pushed fixes again
   only when it is set to. Copilot needs "Review new pushes" turned on in
   the ruleset, and otherwise the author asks it for a new review.
5. **Threads resolved.** A branch ruleset blocks the merge while any thread
   is open, so no comment can be passed over.
6. **Approve and merge.** A written policy approves once the gates pass and
   the threads are resolved. A person approves only where the risk calls for
   one, such as a change to the guardrails themselves.

</details>

## The Practice

### Give Every Reviewer Its Instructions

A reviewer agent with no instructions comments on everything it can. It flags
generated files, repeats what the linter already said, and reviews release
pull requests that hold nothing but a version number. People then skim its
output, and the one comment that mattered is skimmed with the rest.

Never turn on a reviewer without its instruction file. Each tool reads shared
project files and a file of its own.

| Tool               | Shared files it also reads                                  | Its own review file                                                            |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Claude Code Review | `CLAUDE.md`                                                 | `REVIEW.md` at the repository root                                             |
| GitHub Copilot     | `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`                       | `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` |
| CodeRabbit         | `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` | `.coderabbit.yaml` at the repository root                                      |

Keep conventions that every agent needs in the shared files, so they are
written once. Keep review behaviour in each tool's own file. Every review
file should answer the same five questions.

1. **What to skip.** Generated code, lock files, and pull requests that are
   machine made, such as release and dependency updates.
2. **What a check already enforces.** Tell the reviewer not to comment on
   formatting, import order or anything else that fails the build by itself.
   See [Mechanical Checks](../mechanical-checks.md).
3. **Where to look closely.** Name the parts where a mistake is expensive,
   such as authentication, money, migrations or published packages.
4. **How deep to go.** Set a limit on minor remarks, and say which severity
   is worth a comment at all.
5. **How to write.** Language, length and tone of the comments.

### Set Up Each Reviewer

Each reviewer has its own page, with the setup steps and an example of its
instruction file.

- [Claude Code Review](claude-code-review.md) is a managed service. It reads
  `REVIEW.md` from a branch the pull request cannot change.
- [GitHub Copilot Review](copilot-review.md) is turned on by a ruleset. It
  reads its instructions from the branch under review.
- [CodeRabbit](coderabbit.md) reviews pull requests, commits in the editor,
  and local changes from the command line or from a coding agent.

### Answer Every Comment

Each comment gets its own reply, in its own thread. A reply is one or two
lines and takes one of three forms.

- **Fixed**, with the commit that fixed it.
- **Declined**, with the reason.
- **Deferred**, with a link to the issue that now holds it.

Do not answer ten comments with one summary at the bottom of the pull
request. The reply belongs beside the line it concerns, where the next reader
of that line will find it.

An agent may write these replies, and the same limits apply. A reply states
the outcome. It does not start a conversation with the reviewer.

### Resolve When Done

Resolve each thread once its reply is posted. A resolved thread is collapsed
and kept, so anyone can expand it later. When every thread from one review is
resolved, hide that review's summary comment as resolved too. A pull request
with fifteen open review blocks tells the next reader nothing about what is
still outstanding.

Each tool handles its own threads differently.

- **Claude Code Review** resolves its earlier thread on the next review when
  it judges the problem fixed.
- **CodeRabbit** resolves all of its threads when someone posts
  `@coderabbitai resolve` as a top-level comment. Reply to each thread first,
  because the command closes them whether or not they were answered.
- **Copilot** threads are resolved by hand or through the API. I found no
  documented command for it.

<details>
<summary>Doing this through the GitHub API</summary>

The GitHub GraphQL API has a mutation for each step, so an agent can do the
whole of this with the `gh` command line tool.

| Step                  | Mutation                          | Needs                                         |
| --------------------- | --------------------------------- | --------------------------------------------- |
| Reply in a thread     | `addPullRequestReviewThreadReply` | The thread's ID and the reply text            |
| Resolve the thread    | `resolveReviewThread`             | The thread's ID                               |
| Hide a review summary | `minimizeComment`                 | The review's ID and the classifier `RESOLVED` |

</details>

### Approve by Risk

A person's approval is not a requirement of this practice. Many repositories
merge with no human reviewer, and they are safer for it when the conditions
below hold.

A person who approves a change they cannot judge is a meat proxy. Their name
is on the decision, and either a machine made it or nobody did. That approval
adds nothing in four cases.

- **No skill.** The reviewer cannot judge this kind of change.
- **No time.** The reviewer is the bottleneck, and ends up approving unread.
- **No evidence.** The reviewer cannot see what ran, what passed and what the
  change touched.
- **Evidence that can be changed.** What the reviewer sees may differ from
  what ran.

In each case automated guardrails give more assurance than the approval did.
So choose who approves by what a mistake would cost.

| The change                                                                    | Who approves                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------ |
| Cheap to undo and covered by checks, such as a release or a dependency update | Policy alone                                     |
| Product code with tests, gates and reviewer agents                            | Policy, once gates pass and threads are resolved |
| The guardrails themselves, such as checks, rulesets and reviewer instructions | A named person                                   |
| Hard to undo, or one a regulation says a person must sign                     | A named person with the skill and the evidence   |

Removing the person is sound only while four things hold. The fourth case
above applies to automation as much as to people.

1. **The author cannot change the gate.** Checks, hooks, rulesets and
   reviewer instructions need an approval the author cannot give itself.
2. **The approver is not the author.** A separate identity approves, and the
   setup fails when the two are the same.
3. **The evidence is made where the author cannot edit it.** A required
   check on a protected runner counts. The agent's own report does not.
4. **The policy is code.** It names the authors, labels and paths it
   approves, a person owns it, and each approval leaves a record.

Approving a merge is also not approving a shipment, provided the two are
separate steps. Where a merge changes the main branch, nothing deploys from
it and nobody uses the branch directly, a merge puts nothing in front of a
user, and the heavy tests run later against the deployed release. In a
repository that deploys on merge, approving the merge is approving the
shipment. The same holds where others run the main branch as it is, such as
a shared workflow or action that callers pin to the branch name. See
[Merge, Release and Ship](../merge-release-ship.md).

The person does not leave. They stop approving each change and own the
rules instead, which are the specification, the gates and the policy. Count
the defects found after merge, and move a kind of change up a row when that
count rises.

<details>
<summary>Approving without a person on GitHub</summary>

- **A ruleset** requires passing checks, resolved threads and one approving
  review.
- **A second GitHub App** gives that review when the policy's conditions
  hold. GitHub refuses a review from a pull request's own author, so the
  approver must be a different identity from the one that opened it.
- **Code owners** decide which paths the app may approve alone. A path owned
  by a person still waits for that person.
- **Claude Approvals**, in public beta for Team and Enterprise plans, is a
  pull request check driven by a policy file at `.claude/approvals.yml`.
  Each rule names paths and says whether Claude or a person must approve.
  See [Claude Approvals](https://code.claude.com/docs/en/approvals.md).

</details>

### Limit the Rounds

A coding agent can run a reviewer on its own work before the pull request
opens, fix what it finds, and run it again. Stop after two rounds.

1. **Round one** reviews the work. The agent checks each finding against the
   code and fixes the real ones.
2. **Round two** confirms the fixes and catches what they broke.

Anything still open after round two goes into the pull request with a reply,
or to a person. Do not loop until the reviewer returns nothing. A reviewer
does not give the same answer twice, so each run can raise a new minor
remark and the loop may never end. Each run also spends from an hourly
limit.

One round is enough for a small change whose fixes are mechanical.

Check every finding before acting on it. A reviewer's finding is a claim,
the same as an agent's report of success.

## Why

A reviewer agent is cheap to turn on and expensive to leave untuned. Every
comment costs a person's attention, and attention spent on noise is taken
from the findings that matter.

The instruction file is prose, so the reviewer can ignore it. When a
reviewer raises the same finding in three pull requests, the finding belongs
in a linter rule and the instruction file should then tell the reviewer to
stop reporting it.

A reply on each thread is the record of a decision. "Declined, because this
path is covered by the integration test" tells the next engineer more than a
resolved thread with no answer.

Other pages in this section keep text that agents write for agents out of the
repository. Review replies are the one place it is allowed, and they are
bounded. Each is short, attached to a line of code, and collapsed when the
thread is resolved.

## The Failure It Prevents

- Review comments that nobody reads because most of them are noise.
- A finding that was dismissed with no reason recorded.
- A merged pull request with a dozen open review blocks, where nobody can
  tell which were handled.
- A pull request that edits the reviewer's instructions to pass its own
  review.

## How It Is Enforced

- A branch ruleset requires every review thread to be resolved before a
  merge. An unanswered comment then blocks the pull request.
- The same ruleset requests the Copilot review, so no pull request skips it.
- Instruction files are covered by code owners, so a change to them needs
  approval from a person.
- A second app approves the kinds of change the policy names, and the
  approving job fails when the approver and the author are the same.

This repository uses all four. Its ruleset sets
`required_review_thread_resolution` and carries a `copilot_code_review` rule,
and its `.github/copilot-instructions.md` tells Copilot to skip release and
dependency pull requests. Its release pull requests are approved by a
second app when the author, the label and every changed path match, and no
person reads them. It has no `REVIEW.md` or `.coderabbit.yaml`. Claude
Code Review is not installed here, and CodeRabbit has so far been run on it
from the command line only.
