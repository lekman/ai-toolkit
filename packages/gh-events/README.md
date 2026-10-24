# gh-events

Brings GitHub pull request events to this Mac as a local event log. It covers
four events:

- `approved`: the PR's review decision became approved.
- `ci_failed`: the combined check state on the head commit became failure or
  error. A new failing commit is a new event.
- `merged`: the PR was merged.
- `conflict`: GitHub reports the PR cannot merge because of conflicts.

It only notifies. Nothing runs in response to an event, and no model reads the
GitHub data. Actions can be added later as a separate reader of the log. Not
published to npm.

## How It Works

A launchd agent runs `poll` every 60 seconds. Each poll asks GitHub's GraphQL
API for the open PRs you authored or were asked to review, once per
configured account. It compares them with the previous poll and appends one
line to `events.jsonl` per change.

```text
GitHub GraphQL ──(outbound HTTPS)──▶ guard ──▶ diff ──▶ events.jsonl
                                                 ▲
                                            state.json
```

## Decisions

- **Polling, not webhooks.** GitHub has no webhook for merge conflicts. It
  computes `mergeable` only when asked, so a poller is needed for that event
  either way. Polling also means no inbound port, no public endpoint and no
  webhook secret. It works without org-owner rights and across several
  accounts. The cost is up to one interval of delay. A state that changes and
  changes back within one interval is missed.
- **A guard before anything is stored.** Every field that leaves the guard is
  an enum, an integer, a 40-hex SHA or a repo name that matched a strict
  pattern and the allow-list. Titles, branch names, bodies and logins are
  dropped. Anything that later reads the log sees no text a PR author wrote.
  To learn more, a reader asks GitHub with its own credentials.
- **One request per account per poll.** Both searches go in one GraphQL
  request with 50 results per page. GitHub charged 1 point per request,
  against 5,000 points per hour per account. With 100 results per page it
  charged 2. More than 50 open PRs adds a page.
- **Repo filters run in code.** The query names only orgs and users, so it
  stays short and costs the same however many repos you have. GitHub search
  limits query length and boolean operators, so a list of repos in the query
  would break as the list grows.
- **The first poll is a baseline.** It stores state and writes no events, so
  existing approvals and failures do not flood the log. A PR whose
  `mergeable` was still `UNKNOWN` at the baseline stores its first computed
  value without an event.
- **Merges are found by absence.** A PR that leaves the open search is looked
  up by node id. Merged gives an event. Closed, deleted or no longer in scope
  gives nothing.
- **No repeats.** Each event has a key `repo#pr:event:sha`, and a key is never
  written twice.

## Setup

Each account must be signed in to `gh` (`gh auth status` lists them). The
poller reads tokens with `gh auth token --user <login>` and never logs them.

Create `~/.config/gh-events/config.json` (mode 0600, never committed):

```json
{
  "intervalSeconds": 60,
  "accounts": [
    {
      "login": "me",
      "owners": [
        { "name": "acme", "kind": "org", "exclude": ["*-sandbox"] },
        { "name": "me", "kind": "user", "include": ["api", "web-*"] }
      ]
    },
    {
      "login": "me_globex",
      "owners": [{ "name": "globex", "kind": "org" }]
    }
  ]
}
```

- `kind` is `org` or `user` (default `org`).
- `include` and `exclude` are repo name patterns, and `*` is the only
  wildcard. `include` defaults to `["*"]`.
- An enterprise managed account can only see its own enterprise, so it needs
  its own entry.

Run one poll by hand, then install the agent:

```sh
bun src/cli.ts poll
bun src/cli.ts install
```

`install` writes `~/Library/LaunchAgents/com.lekman.gh-events.plist` with the
absolute paths of this checkout and of `bun`. Run it again after moving the
checkout or changing `intervalSeconds`. `uninstall` removes it.

## Files

| Path                                    | What                                     |
| --------------------------------------- | ---------------------------------------- |
| `~/.config/gh-events/config.json`       | Accounts, owners and repo filters        |
| `~/.local/state/gh-events/events.jsonl` | Append-only event log, one JSON per line |
| `~/.local/state/gh-events/state.json`   | Last poll's PRs and recent event keys    |
| `~/Library/Logs/gh-events.log`          | One summary line per account per poll    |

An event line:

```json
{
  "account": "me",
  "at": "2026-01-02T03:04:05.000Z",
  "event": "ci_failed",
  "key": "acme/api#12:ci_failed:<sha>",
  "pr": 12,
  "repo": "acme/api",
  "sha": "<40 hex>"
}
```

The log line names accounts and counts only. When a request fails, the line
gives the HTTP status or the number of GraphQL errors, never the response
body.

## Limits

- Only PRs you authored or were asked to review. A review request disappears
  from search once you review, so later events on that PR are seen only if
  you are also the author.
- GitHub search can lag behind a change by a short time.
- `ci_failed` uses the combined state of the head commit, so one failing
  required or optional check is enough.
