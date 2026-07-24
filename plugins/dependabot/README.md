# dependabot

Dependabot lifecycle skills for a whole GitHub account: find the repos that are
not covered, then bring them under one consistent flow.

## Skills

| Skill                 | Does                                                                                     | Writes? |
| --------------------- | ---------------------------------------------------------------------------------------- | ------- |
| `/dependabot:triage`  | Scans an owner's repos and reports alert coverage gaps and open dependency PRs by status | No      |
| `/dependabot:onboard` | Enables alerts + security fixes, installs grouped `dependabot.yml` and auto-merge         | Yes     |

## The flow onboard installs

1. Dependabot vulnerability alerts (repo setting).
2. Automated security fix PRs (repo setting).
3. `.github/dependabot.yml` — weekly, grouped updates. One PR per ecosystem
   instead of one per package.
4. `.github/workflows/dependabot-auto-merge.yml` — enables native auto-merge for
   github-actions and non-major bumps; holds majors for a human.

## Assets

- `assets/dependabot.yml` — grouped-update config template.
- `assets/auto-merge.yml` — the auto-merge workflow.
- `assets/bootstrap.sh` — idempotent installer; enables settings and copies the
  two files into a checkout without overwriting existing config.

## Typical use

```
/dependabot:triage            # where are the gaps?
/dependabot:onboard <repo>    # close a gap
```

## One manual step

Auto-merge needs **Settings > General > "Allow auto-merge"** turned on in each
repo. That toggle is not reliably settable through the REST API, so the
bootstrap script prints a reminder rather than pretending it did it.

## Token scope

The skills use `gh`. Onboarding writes repo settings and needs the token's
`repo` scope. Triage needs read access to alerts (`repo` for private repos).
