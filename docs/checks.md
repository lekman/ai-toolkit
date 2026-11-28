# Checks

[ai-toolkit](../README.md) / [Docs](README.md)

One section for each check this repository runs on itself. A failed check
prints a rule name and a link to its section here. Each section gives the fix
first and the reason after it, as
[Mechanical Checks](../practices/engineering/mechanical-checks.md) sets out.

## `no-client-content`

**Fix.** Replace each reported match with a placeholder, such as Acme, Globex,
PROJ-123 or acme-platform.

- For a commit message, describe the shape of the change and leave out the
  party. Then amend the commit.
- In continuous integration (CI) the report hides the matched text. Run
  `scripts/check-no-client-content.sh --history` locally to list the files
  that match, and `scripts/check-no-client-content.sh --messages` to list
  the commits. Neither prints the matched line. Run the script with no
  option to see the matching lines in the working tree.
- When the match is already in a commit, a fix on top is not enough. The
  history must be rewritten, so ask the repository owner.
- When the match is a false one, narrow the pattern in
  `scripts/client-terms.txt`. There is no other exemption.

**Why.** This repository is public and is written during client work. A
client name, a ticket key or a meeting title that reaches it is a
confidentiality problem. A build log is public too, which is why the CI
report stays quiet. [scripts](../scripts/README.md) describes the scan.

## `breadcrumbs`

**Fix.** Run `bun run breadcrumbs` and commit the pages it rewrites. Do not
edit a breadcrumb by hand.

**Why.** Each documentation page has one line of links under its title, from
the front page down to its parent. The text of each link is the title of the
page it points at. Moving or renaming a page changes that line on every page
below it, so a script writes the lines and this check fails when one is
missing or out of date. Rule files, skill files and package READMEs have
none, as the script's own comments explain.

## `client-terms-secret`

**Fix.** Add a repository secret named `CLIENT_TERMS` that holds the contents
of `scripts/client-terms.txt`. Repository secrets are under Settings, then
Secrets and variables, then Actions.

**Why.** The term list is not committed, because it names the clients it
protects. Without the secret the scan has nothing to look for, and a scan
with nothing to look for would pass every time. The check fails so that a
missing list is noticed.

## `no-hook-bypass`

**Fix.** Run the command again without `--no-verify`, `git commit -n`, a
variable that disables hooks, or `core.hooksPath`. Then fix what the hook
reports.

- When the hook itself is wrong, propose the change in a pull request. A
  person approves it.
- The guard refuses any command that names `core.hooksPath`, including one
  that only reads the setting. Ask the operator to run that command.

**Why.** The commit hooks are the first gate, and an agent that is trying to
finish a task has a reason to step around them. An agent may propose a change
to a hook and may not decide it.
[Controls: Soft, Hard, Boundary](controls.md) explains the difference.

## `guards-live`

**Fix.** Register the check as a Trunk action with a `git_hooks` trigger in
`.trunk/trunk.yaml`, and add it to the `enabled` list under `actions`. That
file needs a person's approval to change. The other way is to hand the hooks
path back to `.githooks`.

**Why.** Trunk takes over the hooks path the first time it runs in a clone.
From then on a hook that lives only in `.githooks` is never called, while it
still looks installed. This repository lost its leak guard that way once. The
check answers one question for each guard, which is whether a path exists from
`git commit` to the script.

## `lockfile-only`

**Fix.** Check out the pull request's branch and run
`bun install --ignore-scripts`. Read the files it changed besides `bun.lock`,
which the failed job also lists. Commit them by hand when they are intended.

**Why.** The workflow commits to a dependency pull request with nobody
watching. A lockfile that follows `package.json` is safe to commit unread.
Any other changed file is not, so the workflow stops and leaves the decision
to a person.
