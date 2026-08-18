> **Status:** Dispatched | **Date:** 2026-08-18 | **Author:** planning session (weekly Dependabot routine, cloud) | **Repos:** `lekman/auto-approve-action`

# Guard Secret-Dependent CI Jobs Against Dependabot

## Context

`auto-approve-action` runs six CI jobs that each mint a GitHub App token from
`secrets.APP_ID` and `secrets.APP_PRIVATE_KEY`. Dependabot pull requests never
receive repository secrets, so all six fail at the same step on every Dependabot
pull request, and the `CI Success` aggregator fails behind them.

The practical effect is that seventeen Dependabot pull requests have been merged
with red CI. That trains the habit of merging past a red tick, which is exactly
what makes a genuine failure easy to miss.

## Already done, do not redo

- `lekman/ai-toolkit` PR #20 — merged 2026-08-18 — applied the same *idea* to a
  different repo, guarding its `client-content.yml` scan job with
  `if: github.actor != 'dependabot[bot]'`. Reuse the reasoning, not the diff.
  ai-toolkit needs nothing further.
- The planning session did **not** open a pull request against
  `auto-approve-action`. There is no branch to pick up; start fresh.

## What is verified

From pull request #36 (`typescript 6.0.3 → 7.0.2`, merged red by `lekman`), CI
run `28976187656`:

| Job | Failing step |
| --- | ------------ |
| Integration Tests | `Get GitHub App token` |
| Label Validation Tests | `Get GitHub App token` |
| Input Validation Tests | `Get GitHub App token` |
| Path Validation Tests | `Get GitHub App token` |
| Size Validation Tests | `Get GitHub App token` |
| Approval Execution Tests | `Get GitHub App token` |
| Unit Tests | `Install dependencies` |
| CI Success | `Check all tests passed` |

Current guards on those jobs exclude release-please only, not Dependabot:

```yaml
if: github.event_name == 'pull_request' && !startsWith(github.head_ref, 'release-please--')
```

`Unit Tests` carries a different guard
(`github.event_name == 'workflow_dispatch' || !startsWith(...)`) and, by line
position in `.github/workflows/ci.yml`, sits above the first
`secrets.APP_ID` reference, so it appears not to consume App secrets.

## What is not verified

- **Why `Unit Tests` fails at `Install dependencies`.** The planning session
  could not read the job log; the proxy returned HTTP 000 on the redirect to
  blob storage. The working hypothesis is the same bun frozen-lockfile drift
  seen in `ai-toolkit` and `cdn` (manifest bumped, lockfile untouched), but this
  is unconfirmed. Note that `auto-approve-action` does **not** declare the
  `@northbridge-security` dependency, so it is not brief 1's problem.
- Whether `CI Success` fails only as a consequence of its dependencies, or has
  its own logic that needs adjusting when jobs become skipped rather than failed.
  Read its `Check all tests passed` step before assuming.

## Steps

1. **Confirm the `Unit Tests` failure first**, since it is the one unexplained
   item and may be a separate fix:

   ```bash
   gh run view 28976187656 --repo lekman/auto-approve-action --log-failed | head -40
   ```

   If it is lockfile drift, regenerate and commit the lockfile. Do not fold that
   into the guard change; it is a distinct fault and deserves its own commit.

2. **Do not blanket-skip CI on Dependabot branches.** Skipping everything would
   merge dependency bumps with zero test coverage, which is worse than the
   current state, not better. Guard only the six jobs that require App secrets,
   and leave `Unit Tests` running so bumps still get real coverage.

3. **Extend the six guards** to exclude Dependabot alongside release-please. The
   repo's established idiom is `head_ref` prefix matching, so stay with it
   rather than importing ai-toolkit's `github.actor` form:

   ```yaml
   if: >-
     github.event_name == 'pull_request' &&
     !startsWith(github.head_ref, 'release-please--') &&
     !startsWith(github.head_ref, 'dependabot/')
   ```

4. **Check how `CI Success` treats skipped jobs.** A `needs`-based aggregator
   with `if: always()` commonly fails when an upstream job is skipped, because a
   naive check tests for `success` rather than accepting `success || skipped`.
   If so, adjust it in the same pull request, or the aggregate check stays red
   and nothing has actually been fixed.

5. **Verify against a real Dependabot pull request.** Either wait for the next
   one, or comment `@dependabot recreate` on a recent closed one to regenerate
   it. The six jobs should report *skipped*, `Unit Tests` should run and pass,
   and `CI Success` should be green. Skipped rather than passing is the intended
   outcome: a green tick on a job that never ran would misrepresent coverage.

## Failure interpretation

- **Jobs still failing at `Get GitHub App token`** after the change means the
  guard expression did not match. Check `github.head_ref` on the actual pull
  request; it is empty for non-pull-request events, which is why the guards must
  stay paired with the `github.event_name == 'pull_request'` condition.
- **`CI Success` red while all six show skipped** is step 4 unaddressed, not a
  guard failure.
- **A failing `Review` or `claude-review` check is not a build failure.** Those
  automation reviews cannot run on Dependabot pull requests for the same
  secrets reason and are outside this brief's scope.

## Outcome

*Empty at dispatch. The implementing session fills this in: date, what the
`Unit Tests` log showed, whether `CI Success` needed adjusting, the pull request
link, and confirmation that a real Dependabot pull request went green.*
