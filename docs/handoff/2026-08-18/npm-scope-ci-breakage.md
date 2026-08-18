<!-- markdownlint-disable-file MD041 -->
<!-- The handoff contract requires the status header on the first line, ahead of
     the H1. Same exemption as .github/pull_request_template.md. -->

> **Status:** Dispatched | **Date:** 2026-08-18 | **Author:** planning session (weekly Dependabot routine, cloud) | **Repos:** `lekman/mmd`, `lekman/n8n-workflows`

# Private npm Scope Breaks CI Installs

## Context

Every CI job in `mmd` dies at `Install dependencies` before a single test runs,
including on pushes to `main`. The cause is `@northbridge-security/ai-toolkit`,
a devDependency that resolves 404 from the public npm registry. `n8n-workflows`
declares the same dependency and has three Dependabot pull requests stuck in a
blocked state, the oldest from 2026-05-20.

This gates everything else in those two repos: no lint, no typecheck, no tests,
and no mergeable dependency updates until installs work again.

## Already done, do not redo

- `lekman/cdn` was archived by the operator on 2026-08-18. Do not unarchive or
  fix it. It is referenced below only as the reproduction case, because the
  planning session had a working clone of it.
- The `@northbridge-security` scope was briefly suspected of being an
  unregistered name and therefore a dependency-confusion foothold. **That was
  wrong and has been retracted.** `devops-toolkit` publishes under the same
  scope (its root `package.json` is named
  `@northbridge-security/devops-toolkit-root`), so the scope belongs to the
  operator. Do not spend time on a supply-chain investigation.

## What is verified

Established directly by the planning session:

- `@northbridge-security/ai-toolkit@^0.1.12` is a devDependency in `mmd` and
  `n8n-workflows` (and in the now-archived `cdn`).
- `devops-toolkit` is **not** a consumer. It only _publishes_ under the scope.
- Unauthenticated requests return 404 for both the packument
  (`https://registry.npmjs.org/@northbridge-security%2Fai-toolkit`) and the
  tarball for `0.1.12`.
- `cdn`'s `bun.lock` contains a resolved `sha512` integrity hash for `0.1.12`,
  which proves the package was fetchable when the lockfile was written.
- No `.npmrc` is tracked in `cdn`, and its `bunfig.toml` contains only
  `[install] prefer-offline`, test coverage settings, and coverage path
  exclusions. Nothing points the scope at a registry or supplies a token.
- Reproduced in a clean `cdn` clone: `bun install --frozen-lockfile` fails with
  `error: lockfile had changes, but lockfile is frozen`; plain `bun install`
  then fails with `GET .../ai-toolkit-0.1.12.tgz - 404`.
- `mmd` CI run `31996068142` (push to `main`, 2026-08-17) failed with `Lint`,
  `Type Check`, `Test`, and `Security Scan` all failing at the
  `Install dependencies` step, and `Quality Gate` failing at
  `Check quality gate` behind them.

## What is not verified

- **Whether the 404 means "private" or "gone".** npm returns 404 rather than 401
  for unauthorized reads of private packages, so the two are indistinguishable
  without credentials. The planning session had none.
- **Whether `n8n-workflows` fails for this reason.** Its `check-runs` API
  returned 403, so no failing check was ever observed there. Only the shared
  dependency declaration links it to `mmd`.
- **Whether these repos ever had a working npm token in CI** that has since
  expired, versus never having had one.

## Steps

1. **Establish what the package actually is.** From a shell with npm auth:

   ```bash
   npm whoami
   npm access list packages @northbridge-security 2>&1 | head
   npm view @northbridge-security/ai-toolkit versions
   ```

   Expected: either the package resolves and is marked private (the assumed
   case), or it does not exist at all. **This branches the whole brief.**
   - _Private and present_ → continue to step 2.
   - _Genuinely gone_ → stop and consult the operator. The remedy is then to
     republish it, vendor it, or remove the dependency, and that is a product
     decision, not a CI fix.

2. **Decide the registry approach before editing either repo.** There are two
   layers and they are not interchangeable:
   - **Branch and push builds** need an `NPM_TOKEN` repository secret plus an
     `.npmrc` (or a bun registry config) scoping `@northbridge-security` to the
     registry with that token.
   - **Dependabot pull requests get no repository secrets at all.** A plain
     `NPM_TOKEN` secret will therefore fix `main` and leave every Dependabot
     pull request failing exactly as before. Those need a `registries:` block in
     `.github/dependabot.yml` plus a Dependabot-scoped secret (Settings →
     Secrets and variables → Dependabot).

   Doing only the first layer is the predictable trap here. It looks like a fix,
   turns `main` green, and leaves the Dependabot backlog untouched.

3. **Apply to `mmd` first**, since its default branch is broken. Add the
   registry config and both secrets, then push a trivial branch and confirm
   `Install dependencies` succeeds in `Lint`, `Type Check`, `Test`, and
   `Security Scan`.

4. **Confirm the cause in `n8n-workflows` before applying anything.** Read the
   failing check on one of its stuck pull requests (#56, #54, or #52):

   ```bash
   gh pr checks 56 --repo lekman/n8n-workflows
   gh run view <run-id> --repo lekman/n8n-workflows --log-failed | head -40
   ```

   If it fails at dependency install, apply the same fix as `mmd`. If it fails
   somewhere else, stop and write the real cause into Outcome; do not force the
   `mmd` remedy onto it.

5. **Re-run the stuck Dependabot pull requests** once the Dependabot registry
   config is in place. Comment `@dependabot recreate` (not `rebase`) on each, so
   they are rebuilt with the new configuration rather than merely rebased.
   `n8n-workflows` #52 dates from 2026-05-20 and may be far enough behind that
   recreating is the only sensible option.

6. **Verify the lockfiles are consistent** after installs work. `cdn`'s lockfile
   had genuinely drifted from its `package.json`, which is a separate fault from
   the 404 and would still fail `--frozen-lockfile` after auth is fixed. Check
   whether `mmd` and `n8n-workflows` share that drift, and if so regenerate and
   commit the lockfile rather than relaxing the `--frozen-lockfile` flag.

## Failure interpretation

- **`error: lockfile had changes, but lockfile is frozen`** is lockfile drift,
  not an auth problem. The manifest and lockfile disagree. Fix by regenerating
  the lockfile and committing it. Never fix this by dropping
  `--frozen-lockfile`; that flag is what makes CI reproducible.
- **`GET ... .tgz - 404`** is resolution or auth. If it persists _after_ a token
  is configured, the token lacks read access to the scope; it is not a bun
  problem.
- These two can appear in sequence on the same repo, as they did in `cdn`: the
  frozen check fails first and masks the 404 underneath. Clearing one reveals
  the other. Do not assume the first error was the only one.
- **A Dependabot pull request still failing after `main` is green** is the
  expected symptom of having done step 2's first layer but not its second. It is
  not a regression.

## Outcome

_Empty at dispatch. The implementing session fills this in: date, what the npm
lookup in step 1 returned, which registry approach was taken, which repos were
changed, pull request links, and whether the stuck Dependabot pull requests went
green._
