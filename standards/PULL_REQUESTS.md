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
