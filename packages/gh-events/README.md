# gh-events

Brings GitHub pull request and issue state to this Mac as two local files:

- `registry.json`: every PR and issue currently monitored, with its state,
  rewritten after each poll.
- `events.jsonl`: an append-only log of changes. The events are `approved`,
  `ci_failed`, `conflict` and `merged` for PRs, and `issue_assigned` and
  `issue_closed` for issues.

It only notifies. Nothing runs in response to an event, and no model reads the
GitHub data. A consumer, such as a dashboard, reads the two files.
[CONTRACT.md](CONTRACT.md) is what a consumer may rely on: every field, value
and rule. Not published to npm.

## How It Works

A launchd agent runs `poll` every 60 seconds. Each poll asks GitHub's GraphQL
API, once per configured account, for:

- open PRs the account authored or was asked to review
- open issues the account authored or is assigned to

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
  search is looked up by node id. A merged PR or a closed issue gives an
  event. A closed PR, a deleted item or one no longer in scope gives nothing.
- **No repeats.** Each event has a key, and a key is never written twice.

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
          "exclude": ["*-sandbox"]
        },
        {
          "name": "me",
          "kind": "user",
          "client": "home",
          "include": ["api", "web-*"]
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

| Path                                     | What                                       |
| ---------------------------------------- | ------------------------------------------ |
| `~/.config/gh-events/config.json`        | Accounts, owners, clients and repo filters |
| `~/.local/state/gh-events/registry.json` | Monitored items; see CONTRACT.md           |
| `~/.local/state/gh-events/events.jsonl`  | Event log; see CONTRACT.md                 |
| `~/.local/state/gh-events/state.json`    | Internal: last poll's items and event keys |
| `~/Library/Logs/gh-events.log`           | One summary line per account per poll      |

The log line names accounts and counts only. When a request fails, the line
gives the HTTP status or the number of GraphQL errors, never the response
body.

## Limits

- Only items the account authored, was asked to review or is assigned to. A
  review request disappears from search once you review, so later events on
  that PR are seen only if you are also the author.
- GitHub search can lag behind a change by a short time.
- `ci_failed` uses the combined state of the head commit, so one failing
  required or optional check is enough.
- `closes` lists only issues in the PR's own repo.
