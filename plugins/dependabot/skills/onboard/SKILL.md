---
name: onboard
description: Onboard a repository to the Dependabot flow — enable vulnerability alerts and automated security fixes, install a grouped dependabot.yml, and add an auto-merge-on-green workflow. Use when the user says "/dependabot:onboard", "set up dependabot here", or "enable dependabot on <repo>".
argument-hint: [repo-path-or-slug] [--dry-run] [--no-auto-merge] [--pr]
allowed-tools: Bash, Bash(gh *), Bash(git *), Read, Write
user-invocable: true
---

# Dependabot onboard: $ARGUMENTS

Bring one repository under the Dependabot flow: alerts on, grouped update
config in place, and safe updates set to auto-merge once checks pass. This
skill writes files and changes repo settings — confirm the target before
running.

## Inputs

- `repo-path-or-slug` — a local checkout path, or an `owner/name` slug to clone
  first. Default: the current directory.
- `--dry-run` — print every action, change nothing.
- `--no-auto-merge` — install alerts + `dependabot.yml` only; skip the workflow.
- `--pr` — deliver the file changes on a branch and open a PR instead of leaving
  them staged on the current branch. Recommended when `main` is protected.

## What the flow installs

1. Dependabot **vulnerability alerts** (repo setting).
2. **Automated security fixes** (repo setting).
3. `.github/dependabot.yml` — weekly, grouped updates (see `assets/`).
4. `.github/workflows/dependabot-auto-merge.yml` — enables native auto-merge for
   github-actions and non-major bumps; holds majors for review.

The auto-merge workflow only completes a merge after required checks are green.
It also needs **"Allow auto-merge"** on in repo Settings > General — the script
prints this reminder because that toggle is not settable via the REST API in all
plans.

## Step 1 — run the bootstrap

The plugin ships a script that does settings + file writes idempotently (it
never overwrites existing config):

```bash
# Path is relative to this skill: ../../assets/bootstrap.sh
bash "$CLAUDE_PLUGIN_ROOT/assets/bootstrap.sh" ${DRY_RUN:+--dry-run}
```

If `$CLAUDE_PLUGIN_ROOT` is not set, resolve the script relative to this
SKILL.md: `plugins/dependabot/assets/bootstrap.sh`.

For `--no-auto-merge`, run the script, then delete the workflow file it wrote
before committing.

## Step 2 — deliver the changes

- Default: leave the new files staged; show the operator `git status` and the
  diff, and let them commit.
- `--pr`: create a branch `chore/dependabot-onboarding`, commit the files with a
  conventional message (`chore(dependabot): enable alerts, grouped updates,
  auto-merge`), push, and open a PR. Follow the account's PR conventions.

## Step 3 — verify

Confirm the settings took:

```bash
gh api "repos/$REPO/vulnerability-alerts" && echo "alerts: on"
gh api "repos/$REPO/automated-security-fixes" --jq '.enabled'
```

Report: settings state, which files were written vs skipped (pre-existing), and
the one manual step left — turning on "Allow auto-merge" if the workflow was
installed.

## Notes

- Enabling settings needs the token's `repo` scope. If a call returns 403 on a
  repo the operator owns, the token is missing scope, not permission.
- The `dependabot.yml` template covers `github-actions` and `npm`. For other
  ecosystems (pip, bundler, gomod, nuget, cargo), add matching `updates` blocks
  after install; the grouping pattern carries over.
