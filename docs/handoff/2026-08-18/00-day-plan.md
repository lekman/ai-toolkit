> **Status:** Dispatched | **Date:** 2026-08-18 | **Author:** planning session (weekly Dependabot routine, cloud) | **Tickets:** none (no tracker in use)

# Day Plan: Cross-Repo CI Unblock

## Goal

Two independent failures keep CI red across the `lekman` account. Neither is a
dependency problem in the ordinary sense; both are configuration gaps that make
builds fail before any test runs.

1. A private npm scope (`@northbridge-security`) cannot be installed in CI. This
   has `mmd` red **on its default branch**, not just on pull requests.
2. `auto-approve-action` runs six secret-dependent CI jobs that Dependabot pull
   requests can never pass, so dependency bumps have been merged red for months.

## Why this was dispatched rather than executed

The planning session ran in a cloud container with no `gh` CLI, no npm
credentials, and a proxy that blocks GitHub Actions log downloads and most
non-API egress. Several diagnoses below are therefore inference from check
metadata rather than from logs. The local machine has the credentials and log
access to confirm them in minutes. Each brief marks explicitly what is verified
and what is not.

## Ordering

| Order | Brief | Repos | Gate |
| ----- | ----- | ----- | ---- |
| 1 | [npm-scope-ci-breakage.md](npm-scope-ci-breakage.md) | `mmd`, `n8n-workflows` | Decide the private-registry approach before touching either repo |
| 2 | [auto-approve-dependabot-guard.md](auto-approve-dependabot-guard.md) | `auto-approve-action` | None; independent of brief 1 |

Brief 1 first because `mmd`'s default branch is broken, which is a live problem
rather than a backlog one. Brief 2 is independent and can run in parallel if two
sessions are available.

## Already done, do not redo

- `lekman/ai-toolkit` PR #20 — merged 2026-08-18. Adds
  `if: github.actor != 'dependabot[bot]'` to the `scan` job in
  `.github/workflows/client-content.yml`, so the client-content check no longer
  fails closed on Dependabot pull requests. **Do not reapply this to ai-toolkit.**
  The same *pattern* is reused in brief 2, but for a different repo and a
  different set of jobs.
- `lekman/cdn` — archived by the operator on 2026-08-18. It carried the same
  private-scope breakage and six blocked Dependabot pull requests. It is out of
  scope; do not unarchive it to "fix" it. Its evidence is cited in brief 1 only
  because it was the cleanest reproduction available.

## Gaps and risks

1. **The nature of the npm 404 is unconfirmed.** (Low confidence.) The planning
   session could not distinguish "private package, session lacked auth" from
   "package unpublished or deleted". This is the first thing to resolve locally
   and it changes the whole remedy. See brief 1, step 1.
2. **`n8n-workflows` is assumed, not proven, to share `mmd`'s root cause.**
   (Medium confidence.) It declares the same dependency, but its `check-runs`
   API returned 403 to the planning session, so no failing check was ever
   observed. Confirm before assuming the fix transfers.
3. **`web-static` is excluded deliberately.** Its six blocked Dependabot pull
   requests are *not* believed to share this cause: it uses npm rather than bun,
   declares no `@northbridge-security` dependency, uses no secrets in `ci.yml`,
   and already guards Dependabot in both `cd.yml` and `claude-code-review.yml`.
   Its pull requests are mergeable with no conflict, so "blocked" most likely
   means an unmet required review or required check. (Medium confidence; the
   planning session could not read its checks either.) Treat as a separate
   investigation, not part of this dispatch.
4. **Dependabot alerts are invisible to the routine.** (High confidence.) The
   `GET /repos/{owner}/{repo}/dependabot/alerts` endpoint returns 403 on every
   repository. The Claude GitHub App grant covers actions, checks, code, issues,
   pull requests, hooks, and workflows, but not Dependabot alerts or security
   events. Until that permission is added, the weekly sweep can only see version
   bump pull requests, never vulnerability findings. Operator action, not agent
   action.
5. **`check-runs` is 403 on `web-static` and `n8n-workflows`** but works on
   `ai-toolkit`, `mmd`, `cdn`, and `auto-approve-action`. Cause not established.
   It may correlate with how each repo was attached to the cloud session, in
   which case it is an artifact of that environment and not a real permission
   gap. A local `gh` session should not hit this at all.

## Ticket handling

No tracker is in use for these repos. Record outcomes in the Outcome section of
each brief and in the pull request description. Do not open issues unless the
work uncovers something that outlives the fix.
