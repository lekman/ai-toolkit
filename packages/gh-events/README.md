# gh-events

Brings GitHub pull request, issue and security alert state to this Mac as
two local files:

- `registry.json`: every PR, issue and open alert currently monitored, with
  its state, rewritten after each poll.
- `events.jsonl`: an append-only log of changes. The events are `approved`,
  `ci_failed`, `conflict`, `merged`, `closed`, `released`,
  `review_requested` and `changes_requested` for PRs, `issue_assigned` and
  `issue_closed` for issues, and `opened`, `fixed` and `dismissed` for
  Dependabot, code scanning and secret scanning alerts.

No model reads the GitHub data. A consumer, such as a dashboard, reads the
two files. The one action gh-events takes itself is moving tasks in the
task database along with their PRs; see [Tasks](#tasks).
[CONTRACT.md](CONTRACT.md) is what a consumer may rely on: every field, value
and rule. Not published to npm.

## How It Works

A launchd agent runs `poll` every 60 seconds. Each poll asks GitHub's GraphQL
API, once per configured account, for:

- open PRs the account authored or was asked to review
- open issues the account authored or is assigned to

It also reads open alerts from GitHub's REST API for up to 15 repo and alert
type pairs per account, least recently checked first; see
[Alerts](#alerts).

It compares them with the previous poll, appends one line to `events.jsonl`
per change, and rewrites `registry.json`.

```text
GitHub GraphQL ──(outbound HTTPS)──▶ guard ──▶ diff ──▶ events.jsonl
                                                 │   └─▶ registry.json
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
  an enum, an integer, a 40-hex SHA, a timestamp or a repo name that matched a
  strict pattern and the allow-list. Titles, branch names, bodies and logins
  are dropped. A consumer sees no text an author wrote, and takes titles from
  its own records instead.
- **Files, not a push.** A consumer reads the files, so neither side needs the
  other to be running, and the log holds events while a consumer is down.
- **One request per account per poll.** All four searches go in one GraphQL
  request with 50 results per page. GitHub prices a request from the query
  text: each nested connection costs one unit per possible parent. So the PR
  searches, which nest the head commit and the issues a PR closes, cost 2
  points per request, and the issue searches select only issue fields. More
  than 50 results in one search adds a page. Measured: 2 to 3 points per poll
  per account, against 5,000 points per hour per account.
- **Repo filters run in code.** The query names only orgs and users, so it
  stays short and costs the same however many repos you have. GitHub search
  limits query length and boolean operators, so a list of repos in the query
  would break as the list grows.
- **The first poll is a baseline.** It stores state and writes no events, so
  existing approvals and failures do not flood the log. A PR whose
  `mergeable` was still `UNKNOWN` at the baseline stores its first computed
  value without an event.
- **Merges and closes are found by absence.** An item that leaves the open
  search is looked up by node id. A merged PR, a PR closed without merging
  or a closed issue gives an event. A deleted item, or one no longer in
  scope, gives nothing.
- **No repeats.** Each event has a key, and a key is never written twice.
- **Released means in a release.** A merged PR is watched until the repo's
  latest release contains its merge commit, checked with GitHub's compare of
  the two SHAs. The release query costs one request per poll for all waiting
  repos, and a compare runs only when a repo's latest release changes. Tag
  names are author text and are not read.
- **Review events come from the searches already made.** `review_requested`
  is a PR the account did not author entering the review-requested search.
  `changes_requested` is the review decision on the account's own PR. Neither
  adds a request.

## Alerts

GitHub has no GraphQL API for code scanning or secret scanning alerts. Its
org-wide REST endpoints need an org owner or security manager, and a user
account has none. So gh-events asks per repo and alert type, and spreads
the repos over polls:

- **Repo list.** Once an hour, one GraphQL request per owner per 100 repos
  lists the owner's unarchived repos. The include and exclude filters apply.
- **Checks.** Each poll checks up to 15 repo and alert type pairs per
  account, least recently checked first, with one REST request per 100 open
  alerts. With 20 repos, each repo is checked every 4 polls.
- **Lookups.** An alert that left the open list costs one more request, to
  learn whether it was fixed or dismissed. At most 50 per account per poll;
  the rest wait for the next check.
- **No access.** A 403 or 404 means the feature is off for the repo or the
  token cannot read it. The pair is skipped quietly for 24 hours and counted
  in the log line as `without alert access`. A rate-limit 403 or 429 is an
  error instead. Observed on a private repo with the features off: 403 for
  Dependabot and code scanning, 404 for secret scanning.
- **Errors never fail the account.** A failed alert request is counted in
  the log line and leaves that pair's alerts as they were.
- **Budget.** At a 60-second interval, the checks make about 900 REST
  requests per hour per account, plus one per extra page and per lookup,
  against GitHub's 5,000 per hour.
- **Baseline per pair.** The first successful read of a repo and alert type
  stores the open alerts without events.

The token needs the `repo` scope, which `gh auth login` asks for; GitHub
lists it among the scopes these endpoints accept. Alerts are read only;
gh-events never dismisses or changes one.

## Tasks

After each poll, gh-events moves items in the task database
([tasks-mcp](../tasks-mcp/README.md)) that link a PR in `pullRequests`:

| PR                                          | Item state |
| ------------------------------------------- | ---------- |
| Draft                                       | `doing`    |
| Open                                        | `review`   |
| Approved                                    | `approved` |
| Merged                                      | `merged`   |
| Released, or merged in an `unreleased` repo | `done`     |

- An item moves to the least advanced state among its PRs. A PR gh-events
  has not seen counts as open, and a PR closed without merging is left out.
- Items only move forward, and never out of `done` or `dropped`. A request
  for changes does not move an item back; the agent working on it does that.
- The change goes past another agent's claim (`force`), is recorded under
  `gh-events`, and logs a note naming the PR.
- PRs whose stage changed are queued in `state.json`. When the task server
  cannot be reached, the queue waits for the next poll, so nothing is lost
  while the Mac mini sleeps.
- The server address and token are found as the `tasks` command finds them:
  `TASKS_MCP_URL` or the env block of `~/.claude/settings.json`, and
  `TASKS_MCP_TOKEN` or the Keychain item `tasks-mcp-token`. Without both, the
  sync is skipped.

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
        {
          "name": "acme",
          "kind": "org",
          "client": "acme",
          "exclude": ["*-sandbox"],
          "unreleased": ["infra-*"]
        },
        {
          "name": "me",
          "kind": "user",
          "client": "home",
          "include": ["api", "web-*"],
          "repos": { "web-shop": "initech" }
        }
      ]
    },
    {
      "login": "me_globex",
      "owners": [{ "name": "globex", "kind": "org", "client": "globex" }]
    }
  ]
}
```

- `kind` is `org` or `user` (default `org`).
- `client` is the consumer's id for the client this owner's repos belong to.
  It is copied to every item and event, so the consumer never guesses a client
  from an org name. It defaults to null.
- `repos` maps a repo name under this owner to a client id, for a repo that
  belongs to a different client than the owner. It wins over `client`. Set a
  repo to null to hold it as unknown.
- `include` and `exclude` are repo name patterns, and `*` is the only
  wildcard. `include` defaults to `["*"]`.
- `unreleased` lists repo name patterns that never publish a release, such as
  infrastructure or notes repos. A merge there moves a task to `done`
  instead of waiting for a release. Use `["*"]` for an owner with no
  releases at all. It defaults to `[]`.
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

| Path                                     | What                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `~/.config/gh-events/config.json`        | Accounts, owners, clients and repo filters                                                          |
| `~/.local/state/gh-events/registry.json` | Monitored items; see CONTRACT.md                                                                    |
| `~/.local/state/gh-events/events.jsonl`  | Event log; see CONTRACT.md                                                                          |
| `~/.local/state/gh-events/state.json`    | Internal: last poll's items and open alerts, event keys, PRs awaiting a release, and the task queue |
| `~/Library/Logs/gh-events.log`           | One summary line per account per poll                                                               |

The log line names accounts and counts only. When a request fails, the line
gives the HTTP status or the number of GraphQL errors, never the response
body.

## Limits

- Only items the account authored, was asked to review or is assigned to. A
  review request disappears from search once you review, so later events on
  that PR are seen only if you are also the author.
- A review requested again on the same head commit gives no second
  `review_requested`, because the key is the same.
- `approved` and `changes_requested` read GitHub's review decision, which is
  null on a repo that requires no review.
- Alert events can lag by several polls, because repos are checked in turn.
- An alert that is reopened and fixed again gives no second event.
- GitHub search can lag behind a change by a short time.
- `ci_failed` uses the combined state of the head commit, so one failing
  required or optional check is enough.
- `closes` lists only issues in the PR's own repo.
