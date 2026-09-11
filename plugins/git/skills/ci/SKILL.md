---
name: ci
description: Drive a pull request through every gate and merge it when green. Reads the checks, the AI reviewer's verdict on the head commit and every review thread; fixes what is fixable; answers and resolves each thread with the commit; pushes once per round; merges when all of it holds. Use when the user says "/git:ci", "get this PR green", "drive the PR to merge" or "clear the review".
argument-hint: "[pr-number|branch] [--merge] [--admin]"
user-invocable: true
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Drive a Pull Request to Green

One job: take a pull request from open to merged without a person repeating
the loop, and without a single silent pass along the way.

## What It Does

1. Resolve the pull request and confirm it is not a draft.
2. Loop until green: read every signal, fix what is fixable, answer and
   resolve every review thread, push once per round.
3. Merge when all of it holds, if asked to.

## Argument

One positional argument, the PR number or a branch name. With no argument,
the PR for the current branch. `--merge` merges on a pass with the method
the repository allows. `--admin` adds the ruleset bypass and is only for an
operator who has said so for this repository.

## The Green Test

**Run the bundled script. Do not assemble the checks by hand.**

```sh
${CLAUDE_PLUGIN_ROOT}/skills/ci/green.sh                 # the current branch's PR
${CLAUDE_PLUGIN_ROOT}/skills/ci/green.sh <N>             # by number
${CLAUDE_PLUGIN_ROOT}/skills/ci/green.sh <N> --local     # also run the local quality command
${CLAUDE_PLUGIN_ROOT}/skills/ci/green.sh <N> --merge     # report, and merge on a pass
```

It prints one line per condition and exits non-zero unless all of them hold.
The script exists because four of the six conditions have at some point
reported green when they should not have, and every one of those failures
was silent:

| Condition | How it failed open                                                        |
| --------- | ------------------------------------------------------------------------- |
| 1 threads | a single page of 100 reported zero unresolved from a truncated list       |
| 2 review  | a reviewer's error record counted as a review; the ruleset counted it too |
| 4 checks  | a pending check has not failed, so "zero failures" passed                 |
| 5 quality | a `grep -c` counted the linter's own summary line as a finding            |

All six must hold on the head commit, re-checked after every push.

### 1. No Unresolved Review Threads

Counted through the API, paginated to the end. Never eyeball the PR page.

### 2. The Reviewer Has Reviewed the Head Commit

Which reviewer is detected from who has posted on the PR, or set with
`--reviewer`. Each leaves a different trace, and the script checks the one
that cannot be faked by a stale round:

- **Claude Review** runs as a workflow on the head SHA and edits one summary
  comment in place, so the evidence is a completed, successful run on the
  head, not the comment's timestamp.
- **Copilot** posts a review carrying `commit_id`. It must be on the head, it
  must not be an error record ("encountered an error and was unable to
  review"), and its two file counts must match, or the gap must be named
  (a rename or a deletion) and allowed with `GREEN_ALLOW_FILE_GAP=1`.
- **CodeRabbit** posts a review carrying `commit_id`. It must be on the head.

Whether the review says it found nothing is not part of this condition.
Condition 1 covers what it raised, and a thread answered and resolved is the
answer. A finding can be closed with no code change, which leaves the head
where it was and the reviewer's last words unchanged; requiring a "clean"
marker would deadlock exactly the most considered reply.

### 3. Read What the Reviewer Said Outside the Threads

Copilot's suppressed-comments block, Claude's summary table and its "not
raised" and "not verified" sections, CodeRabbit's counts. Never a blocker,
always read. On more than one repository the more serious findings arrived
there rather than as posted threads. Act on them, or record why not.

### 4. Every Check Has a Verdict, and None Failed

Zero failing or cancelled, and zero pending. A check that has not started
has not failed either, so counting only failures merges before the gates
have run. Skipped and neutral are verdicts and are fine.

### 5. Local Quality on the Exact Tree You Push

CI may pass with warnings this does not. The script detects `task quality`
or `bun run lint` (or takes `GREEN_QUALITY_CMD`) and runs it with `--local`.
A run from before your last edit is not evidence about the commit.

### 6. Mergeable

`MERGEABLE` and neither `BEHIND` nor `DIRTY`. On a conflict, merge the
default branch into the branch. Never rebase a branch someone else may hold,
and never force-push one.

## Answering a Review Round, in This Order

A push restarts the reviewer. Replies written after the push race the next
round, so the reviewer re-reads with no idea what you did and the same
finding comes back reworded.

1. **Triage** every open thread. Read the code it points at, not just the
   comment. Decide: fix, decline, or defer.
2. **Fix and commit locally. Do not push.** One commit per round, or one per
   finding when they are unrelated. Then run what the pre-push hook runs
   (`--local` runs the quality command; run the tests too), so the push
   cannot be rejected after the replies have named the commit. A rejected
   push means an amend, and an amend changes the SHA every reply cites.
3. **Reply on every thread, then resolve it.** Three shapes:
   - Fixed: what changed and the short commit SHA.
   - Declined: why it does not apply, with the evidence you checked.
   - Deferred: where it is tracked. Do not resolve a deferred thread you
     have not tracked.
4. **Push once.** The whole round in that push. `threads.sh reply` prints
   each reply's own id; keep them until the push lands, because the list
   hides resolved threads afterwards; `threads.sh replies` lists your own
   replies with their ids if they were not kept. If the push is still
   rejected, fix, amend, and rewrite each reply with
   `threads.sh amend <reply-id> "..."` so it names the commit that lands.

```sh
${CLAUDE_PLUGIN_ROOT}/skills/ci/threads.sh list <N>
${CLAUDE_PLUGIN_ROOT}/skills/ci/threads.sh reply <comment-id> <thread-id> "Fixed in abc1234: the drop now runs in a finally, so a rejected close cannot skip it."
${CLAUDE_PLUGIN_ROOT}/skills/ci/threads.sh reply <comment-id> <thread-id> "Not changing: nothing outside the module reads it, checked with grep before deciding."
```

Then wait for the new round and run the green test from the top. Expect
several rounds: a new commit means a new review. When a round repeats a
finding you declined, the reply was not clear enough; answer once more with
the evidence, then stop.

### Verify a Finding Before Accepting It

A reviewer can be right about the symptom and wrong about the cause, and can
also be wrong. Reproduce first. Findings confirmed by reproduction have more
than once turned out worse than reported, and one in the same round turned
out not to exist. The reviewer will sometimes say which of its findings it
could not verify itself; those are the first to reproduce.

### Mutation-Check a Guard Before Claiming It Works

A test that has never been seen to fail is a claim. Break the thing it
guards, watch the test fail, restore it, watch it pass.

## Merging

The repository's rules decide who approves. Where a person must approve,
the skill reports green and stops; where the operator has granted admin
merge for the repository, `--admin` is the way to say so on the command
line, and the six conditions above are then the whole control, because the
bypass waives CI. Never merge on a partial check: not while a thread is
open, and not on a previous commit's green.

The merge method follows the repository settings, squash first. The branch
is deleted on merge.

Before merging, read the PR body once more. A PR that fixes the cause of a
defect but not the defect should say so; `Closes` on a ticket that still
needs work is a false record.

## Stop and Report Instead

- A gate fails for a reason outside the diff: infrastructure, credentials,
  a runner that is not picking up jobs. Say which; do not retry blindly.
- A thread asks for a decision that is the operator's: scope, a product
  behaviour, a governance rule.
- The green test is not reached in six rounds. Report what is still open.
- CI failed on the head commit: surface the failing job first; do not triage
  reviews on a red build.
- A push is rejected: the remote moved, most often because a post-merge job
  updated the branch. Pull with a merge, never force-push.

## Related

`/git:pr` opens the pull request this skill drives. The stack guard stops a
second PR against the default branch while one of yours is open.
