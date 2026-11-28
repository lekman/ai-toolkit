# Pull Requests

## Turn On Auto-fix for Every Pull Request You Open

**AFTER** you open a pull request, turn on Auto-fix for it in the same turn. Do
not ask first. I have already said yes to every pull request you open.

In the Claude desktop app this is the `ccd_pr` tools. Call `get_status`, bind
the pull request with `bind_pr` if it is not bound, then call `set_monitor` with
`auto_fix: true` and the pull request's URL. The app then wakes the session on
a CI failure, a merge conflict or a review comment, and the session fixes,
commits and pushes without waiting for me.

The app has no setting that turns Auto-fix on by default, so this rule does
that job. Outside the desktop app the tools do not exist. Skip the step there
and say once that CI is not being watched.

This covers pull requests you open, not ones you find. Turn Auto-fix on for
someone else's pull request only when I ask.

## Turn On Auto-merge in My Private Repositories

**AFTER** you open a pull request in a private repository that my own account
owns, turn on auto-merge with squash in the same turn. Do not ask first, and do
not leave a pull request open for me once it is ready.

These repositories need no approving review. Their rulesets require the checks
to pass and every review thread to be resolved, and GitHub merges the pull
request when both are true. Where a review bot reports a check, that check is
required too, so the merge waits until the review finishes or is skipped.

If a review bot reviews the repository and its check is not a required check,
wait for its first review before you turn on auto-merge. Without that wait the
checks can pass before the review arrives, and the pull request merges with no
review. Tell me that the check is not required.

Use the pull request's URL in every command. Given only a number, `gh` reads
the repository from the current folder, and the session may sit in another
repository.

- In the Claude desktop app, call `set_auto_merge` from the `ccd_pr` tools with
  the URL.
- Elsewhere, run `gh pr merge <url> --auto --squash`.
- GitHub refuses auto-merge on a pull request that already meets every rule.
  Merge that one directly with `gh pr merge <url> --squash`.
- GitHub also refuses when the repository setting does not allow auto-merge.
  Leave the setting as it is. Wait for the checks, merge directly once they
  pass and every thread is resolved, and tell me the setting is off.

Check the repository before you rely on this rule. Take the owner and the name
from the pull request's URL and run
`gh repo view <owner>/<name> --json isPrivate,owner`, which shows whether the
repository is private and who owns it. The rule applies when the owner is my
personal account. A public repository, an organisation's repository and a
client's repository keep their own merge rules.

Auto-merge does not wait for a second review round. The section below allows
at most two rounds, and it does not require the second one here. A pull request
in these repositories merges after round one, once its comments are fixed and
their threads are resolved. When the fixes need another review, turn auto-merge
off before you push them, ask for round two, and turn it on again when that
round is done.

This covers pull requests you open. Merge someone else's pull request only when
I ask.

## Stop After Two Review Rounds

**NEVER** let a reviewer and Auto-fix answer each other without a limit. A
reviewer that reviews each push comments on every fix, and Auto-fix pushes a
fix for every comment, so each one wakes the other.

A round is one review and the fixes for it. Round one is the review that runs
when the pull request opens. Ask for round two once, after those fixes are
pushed. After round two:

- Reply to each new review comment in its thread, and do not push a fix for
  it.
- List the comments that are still open for me, and stop.
- Keep fixing CI failures and merge conflicts. They do not count as rounds.

If a reviewer reviews each push by itself, pause it on that pull request
where it has a command for that, such as `@coderabbitai pause`. Then tell me
which setting turns it off for the repository.

## Link Every Pull Request to Its Task

**AFTER** you open a pull request for work that has a task in the task
database, add it to that task's `pullRequests` with `task_update`, as
`owner/repo#number`. Read the task first and pass the whole list with yours
added, at the revision you read.

Dashboards show a task's linked pull requests and nothing else. A task with
no links falls back to every pull request that mentions its ticket, which
includes release notes and related work. Without the link, the task looks
busier or emptier than it is.

Skip the step when the session has no `tasks` tools, or the work has no task.
