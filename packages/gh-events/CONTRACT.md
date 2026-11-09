# gh-events Contract

What gh-events writes and what a consumer may rely on. gh-events is the
producer. A consumer is any local process that reads its two output files,
such as a dashboard server. This document is the agreement between them:
change it before changing either side.

## Roles

- **gh-events is the only process that holds GitHub tokens or calls
  GitHub** for this data. A consumer never calls GitHub to fill in a field.
- **A consumer reads files only.** No HTTP push and no socket. The files are
  the buffer, so either side can be down without losing data.
- **Both run as the same user on the same machine.** The files are mode
  0600 in a mode 0700 folder.

| File                                     | What                                          |
| ---------------------------------------- | --------------------------------------------- |
| `~/.local/state/gh-events/registry.json` | Every monitored item, rewritten each poll     |
| `~/.local/state/gh-events/events.jsonl`  | Append-only log of changes, one JSON per line |

`XDG_STATE_HOME`, when set, replaces `~/.local/state`.

## What Never Appears

No field carries text a PR or issue author wrote. Titles, bodies, branch
names, labels, comments and logins are dropped by the guard before anything
is stored. Every value is one of these:

- an enum value listed below
- an integer
- a 40-character lowercase hex SHA
- an ISO 8601 UTC timestamp
- a repo name `owner/name` that matched `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`
  and the configured allow-list
- an account login or a client id from the operator's own config. A
  client id set for a single repo wins over the one set for its owner, so
  one owner's repos can belong to different clients
- for a Dependabot alert, the package name, when it matched
  `^[A-Za-z0-9@][A-Za-z0-9@/._:+-]{0,213}$`; otherwise null

For alerts, advisory and rule text, file paths, messages, secret types and
secrets are never read. A secret scanning request asks GitHub to leave the
secret out of the response.

A consumer should still validate every line against its own schema, as a
second guard.

## Monitored Items

A PR or issue is monitored while it is open and the account either:

- authored the PR or was asked to review it, or
- authored the issue or is assigned to it.

An alert is monitored while it is open, for Dependabot, code scanning and
secret scanning alerts in any unarchived repo the configured owners hold
that the account can read.

Only repos under configured owners, after their include and exclude
filters, are monitored. An item leaves `registry.json` when it is merged,
closed, fixed, dismissed, or no longer in scope. Merges, closes, fixes and
dismissals also produce an event; an item that only left scope does not.

`(repo, number)` identifies a PR or an issue. GitHub numbers PRs and issues
from one sequence per repo, so the pair is unique across both kinds. Each
alert type has its own sequence per repo, so `(repo, alert_type, number)`
identifies an alert, and an alert number can equal a PR number. Compare
`repo` without regard to case.

## registry.json

Written after every poll, including a poll where every account failed. It
is written to a temporary file in the same folder and renamed into place,
so a reader always sees a whole file.

```json
{
  "version": 1,
  "generatedAt": "2026-01-02T03:04:05.000Z",
  "intervalSeconds": 60,
  "accounts": [
    {
      "login": "me",
      "ok": true,
      "polledAt": "2026-01-02T03:04:05.000Z",
      "error": null
    }
  ],
  "items": [
    {
      "kind": "pr",
      "repo": "acme/api",
      "number": 12,
      "url": "https://github.com/acme/api/pull/12",
      "account": "me",
      "client": "acme",
      "state": "OPEN",
      "review": "APPROVED",
      "ci": "FAILURE",
      "mergeable": "MERGEABLE",
      "sha": "0123456789abcdef0123456789abcdef01234567",
      "closes": [7],
      "since": "2026-01-01T09:00:00.000Z"
    },
    {
      "kind": "issue",
      "repo": "acme/api",
      "number": 7,
      "url": "https://github.com/acme/api/issues/7",
      "account": "me",
      "client": "acme",
      "state": "OPEN",
      "review": null,
      "ci": null,
      "mergeable": null,
      "sha": null,
      "closes": [],
      "since": "2026-01-01T08:00:00.000Z"
    },
    {
      "kind": "alert",
      "repo": "acme/api",
      "number": 4,
      "url": "https://github.com/acme/api/security/dependabot/4",
      "account": "me",
      "client": "acme",
      "alert_type": "dependabot",
      "severity": "high",
      "package": "left-pad",
      "state": "OPEN",
      "review": null,
      "ci": null,
      "mergeable": null,
      "sha": null,
      "closes": [],
      "since": "2026-01-01T07:00:00.000Z"
    }
  ]
}
```

### Top Level

| Field             | Type    | Meaning                                                                |
| ----------------- | ------- | ---------------------------------------------------------------------- |
| `version`         | integer | Contract version. `1` today. See Versioning                            |
| `generatedAt`     | string  | When this file was written                                             |
| `intervalSeconds` | integer | Seconds between polls                                                  |
| `accounts`        | array   | One entry per configured GitHub account, in config order               |
| `items`           | array   | Monitored items, sorted by `repo`, `number`, `kind`, then `alert_type` |

### accounts[]

| Field      | Type           | Meaning                                                   |
| ---------- | -------------- | --------------------------------------------------------- |
| `login`    | string         | The GitHub login the account polls as                     |
| `ok`       | boolean        | The latest poll of this account succeeded                 |
| `polledAt` | string or null | The latest successful poll; null before the first one     |
| `error`    | string or null | Why the latest poll failed: an HTTP status or error count |

A failed account keeps its items from its last successful poll, so a
consumer sees them as possibly stale, not as closed.

### items[]

| Field       | Type                         | PR                                                                              | Issue                                       |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| `kind`      | `"pr"`, `"issue"`, `"alert"` | `"pr"`                                                                          | `"issue"`                                   |
| `repo`      | string                       | `owner/name`                                                                    | same                                        |
| `number`    | integer                      | PR number                                                                       | issue number                                |
| `url`       | string                       | `https://github.com/{repo}/pull/{number}`                                       | `https://github.com/{repo}/issues/{number}` |
| `account`   | string                       | Login of the account that sees it                                               | same                                        |
| `client`    | string or null               | Client id configured for the repo, else for its owner; null when neither is set | same                                        |
| `state`     | enum                         | `OPEN`, `DRAFT`                                                                 | `OPEN`                                      |
| `review`    | enum or null                 | `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or null                     | null                                        |
| `ci`        | enum or null                 | `SUCCESS`, `FAILURE`, `ERROR`, `PENDING`, `EXPECTED`, or null                   | null                                        |
| `mergeable` | enum or null                 | `MERGEABLE`, `CONFLICTING`, `UNKNOWN`                                           | null                                        |
| `sha`       | string or null               | Head commit SHA                                                                 | null                                        |
| `closes`    | integer[]                    | Issue numbers in the same repo this PR closes, sorted, at most 50               | `[]`                                        |
| `since`     | string                       | When gh-events first saw the item                                               | same                                        |

The `url` is built from `repo` and `number`, never copied from GitHub, so a
consumer can match it against its own tracker links in the same form.

#### Alert Items

An alert item has the fields below. `review`, `ci`, `mergeable` and `sha`
are null and `closes` is `[]`, as for an issue. The three alert fields
appear on alert items only.

| Field        | Type           | Alert                                                                                                                    |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `kind`       | `"alert"`      | `"alert"`                                                                                                                |
| `repo`       | string         | `owner/name`                                                                                                             |
| `number`     | integer        | The alert number, from the alert type's own sequence in the repo                                                         |
| `url`        | string         | `https://github.com/{repo}/security/{page}/{number}`, where `page` is `dependabot`, `code-scanning` or `secret-scanning` |
| `account`    | string         | Login of the account that sees it                                                                                        |
| `client`     | string or null | As for PRs                                                                                                               |
| `alert_type` | enum           | `dependabot`, `code_scanning`, `secret_scanning`                                                                         |
| `severity`   | enum or null   | `critical`, `high`, `medium`, `low`, or null                                                                             |
| `package`    | string or null | Dependabot: the package name, or null when it failed the pattern. Other types: null                                      |
| `state`      | enum           | `OPEN`                                                                                                                   |
| `since`      | string         | When gh-events first saw the alert                                                                                       |

The `url` is never copied from GitHub. `state` is always `OPEN`, because a
fixed or dismissed alert is not monitored; those appear only as events.

`severity` is the vulnerability's severity for Dependabot, and the rule's
security severity for code scanning. It is null for a code scanning rule
without a security severity, and always null for secret scanning.

#### Value Meanings

| Field       | Value               | Meaning                                                                              |
| ----------- | ------------------- | ------------------------------------------------------------------------------------ |
| `state`     | `OPEN`              | Open. For a PR, ready for review                                                     |
| `state`     | `DRAFT`             | An open PR marked as a draft                                                         |
| `review`    | `APPROVED`          | The required reviews approve it                                                      |
| `review`    | `CHANGES_REQUESTED` | A reviewer asked for changes                                                         |
| `review`    | `REVIEW_REQUIRED`   | A review is required and not given yet                                               |
| `review`    | null                | The repo requires no review                                                          |
| `ci`        | `SUCCESS`           | Every check and status on the head commit passed                                     |
| `ci`        | `FAILURE`           | At least one failed                                                                  |
| `ci`        | `ERROR`             | At least one errored                                                                 |
| `ci`        | `PENDING`           | At least one is running or queued                                                    |
| `ci`        | `EXPECTED`          | A required status has not reported yet                                               |
| `ci`        | null                | The head commit has no checks                                                        |
| `mergeable` | `MERGEABLE`         | Can merge without conflicts                                                          |
| `mergeable` | `CONFLICTING`       | Has merge conflicts                                                                  |
| `mergeable` | `UNKNOWN`           | GitHub has not computed it yet; gh-events keeps the last known value when it has one |

`MERGED` and `CLOSED` never appear in `registry.json`, because merged and
closed items are not monitored. They appear only as events.

A consumer that keeps fewer states may map them, for example `ci` to
passing (`SUCCESS`), failing (`FAILURE`, `ERROR`), pending (`PENDING`,
`EXPECTED`) and none (null).

### Freshness

`generatedAt` changes on every poll. Treat the source as stale when
`generatedAt` is older than three times `intervalSeconds`. Treat one
account as stale when its `ok` is false or its `polledAt` is that old.

## events.jsonl

One JSON object per line, appended after each poll that found changes.

```json
{
  "v": 1,
  "key": "acme/api#12:ci_failed:0123456789abcdef0123456789abcdef01234567",
  "event": "ci_failed",
  "kind": "pr",
  "repo": "acme/api",
  "number": 12,
  "account": "me",
  "client": "acme",
  "sha": "0123456789abcdef0123456789abcdef01234567",
  "at": "2026-01-02T03:04:05.000Z"
}
```

An alert event carries three more fields:

```json
{
  "v": 1,
  "key": "acme/api#alert-dependabot-4:opened",
  "event": "opened",
  "kind": "alert",
  "repo": "acme/api",
  "number": 4,
  "account": "me",
  "client": "acme",
  "sha": null,
  "alert_type": "dependabot",
  "severity": "high",
  "package": "left-pad",
  "at": "2026-01-02T03:04:05.000Z"
}
```

| Field        | Type                         | Meaning                                                               |
| ------------ | ---------------------------- | --------------------------------------------------------------------- |
| `v`          | integer                      | Line version. `1` today                                               |
| `key`        | string                       | Unique id of this event; see below                                    |
| `event`      | enum                         | One of the events below                                               |
| `kind`       | `"pr"`, `"issue"`, `"alert"` | The item's kind                                                       |
| `repo`       | string                       | `owner/name`                                                          |
| `number`     | integer                      | PR, issue or alert number                                             |
| `account`    | string                       | Login of the account that saw it                                      |
| `client`     | string or null               | As in `registry.json`                                                 |
| `sha`        | string or null               | Head commit SHA for PR events; null for issue and alert events        |
| `alert_type` | enum                         | Alert events only. As in `registry.json`                              |
| `severity`   | enum or null                 | Alert events only. As in `registry.json`                              |
| `package`    | string or null               | Alert events only. As in `registry.json`                              |
| `at`         | string                       | When the poll that saw the change ran, not when it happened on GitHub |

### Events

| Event               | Kind  | When                                                                                                               |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `approved`          | pr    | `review` became `APPROVED`                                                                                         |
| `ci_failed`         | pr    | `ci` became `FAILURE` or `ERROR` on a head commit. A new failing commit is a new event                             |
| `conflict`          | pr    | `mergeable` became `CONFLICTING`                                                                                   |
| `merged`            | pr    | The PR was merged                                                                                                  |
| `released`          | pr    | The repo's latest release contains the PR's merge commit                                                           |
| `closed`            | pr    | The PR was closed without merging                                                                                  |
| `review_requested`  | pr    | The account's review was requested on a PR it did not author                                                       |
| `changes_requested` | pr    | `review` became `CHANGES_REQUESTED` on a PR the account authored                                                   |
| `issue_assigned`    | issue | The account became an assignee                                                                                     |
| `issue_closed`      | issue | The issue was closed                                                                                               |
| `opened`            | alert | An alert is open that the last check of its repo and type did not list                                             |
| `fixed`             | alert | The alert was fixed. For secret scanning: resolved as revoked                                                      |
| `dismissed`         | alert | The alert was dismissed, including Dependabot's auto-dismissal. For secret scanning: resolved for any other reason |

`review_requested` fires when the PR enters the account's review-requested
search. A review takes the PR out of that search, so a request after a
review, on a new head commit, is a new event. A request again on the same
head commit is not, because its key is the same. `changes_requested`, like
`approved`, reads GitHub's review decision, which is null on a repo that
requires no review, so neither fires there.

Alerts are checked in turn: each poll reads up to 15 repo and alert type
pairs, least recently checked first. So an alert event arrives within about
`ceil(3 × repos ÷ 15)` polls, not within one. The first successful read of
a repo and alert type stores a baseline without events, so a repo that
comes into scope, or whose alerts become readable, does not flood the log.
An alert that leaves the open list is looked up once to learn whether it
was fixed or dismissed; one that cannot be read is dropped without an
event.

After a `merged` event, gh-events compares the merge commit with the repo's
latest release on each poll, and only when that release changes. It stops
watching after 180 days. A repo the operator marks `unreleased` gives no
`released` event. A release counts when it contains the merge commit, so in
a repo with one release per package, a release of any package counts.

The first poll of an account writes no events, so state that existed
before gh-events started does not flood the log. A PR whose `mergeable` was
still `UNKNOWN` at that first poll stores its first computed value without
a `conflict` event. A PR or issue that enters scope later reports its
current state, for example a new PR that already fails CI gives
`ci_failed`.

### Keys

For PRs and issues, `key` is `{repo}#{number}:{event}:{discriminator}`. The
discriminator is the head SHA for PR events, `merged`, `closed`,
`released`, `review_requested` and `changes_requested` included, `closedAt`
for `issue_closed`, and `-` for `issue_assigned`.

For alerts, `key` is `{repo}#alert-{alert_type}-{number}:{event}`, for
example `acme/api#alert-code_scanning-30:fixed`. It has no discriminator.

gh-events never writes a key twice. A consumer de-duplicates by `key` too,
so reading a line twice is harmless.

Because `issue_assigned` uses `-`, an issue that is unassigned and assigned
again gives no second event. In the same way, an alert that is reopened and
fixed again gives no second `opened` or `fixed`.

### Reading the Log

- The file is only ever appended to. It is **never truncated or rewritten
  in place**.
- Each poll appends whole lines in one write. A reader processes up to the
  last newline and leaves a partial last line for the next read.
- Keep a byte offset and the last `key` read.
- **Rotation is by rename, to a predictable name.** If gh-events rotates the
  log, it renames `events.jsonl` to `events.<UTC time>.jsonl` in the same
  folder, with the time as `YYYYMMDDTHHMMSSZ` (for example
  `events.20270101T000000Z.jsonl`), then starts a new `events.jsonl`. A
  rotated file is never renamed again or written to.
- **Finishing a rotated file.** Keep the inode of the file you read, next to
  the byte offset. When the inode at `events.jsonl` differs from the stored
  one, look for the stored inode among the `events.*.jsonl` files in the
  folder. If found, read it from the stored offset to its end, then read the
  new `events.jsonl` from offset 0. This works across a reader restart, and
  `key` de-duplication covers any overlap.
- gh-events does not rotate today.
- A line without `v`, or with a `v` the reader does not know, is not part of
  this contract. Count it and skip it.

## Versioning

- Adding a field, an enum value or an event is not a version change. A
  consumer ignores fields it does not know and counts values and events it
  does not know.
- Removing or renaming a field, or changing what a field means, raises
  `version` in `registry.json` or `v` in `events.jsonl`.
- A consumer refuses a `version` it does not know and reports that, instead
  of guessing.
- The `alert` kind, its fields and events, and the `review_requested` and
  `changes_requested` events were added under version 1. A consumer that
  ignores unknown kinds, fields and events reads the files as before.

## Not in This Contract

- **Titles.** Never written. A consumer that needs a title takes it from its
  own records, matched by `(repo, number)`.
- **Branch names.** Never written.
- **An explicit watch list** for items the account did not author and was
  not asked to review. Planned later as a file the consumer writes and
  gh-events reads.
