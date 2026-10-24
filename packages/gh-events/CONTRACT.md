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

A consumer should still validate every line against its own schema, as a
second guard.

## Monitored Items

An item is monitored while it is open and the account either:

- authored the PR or was asked to review it, or
- authored the issue or is assigned to it.

Only repos under configured owners, after their include and exclude
filters, are monitored. An item leaves `registry.json` when it is merged,
closed, or no longer in scope. Merges and closes also produce an event; an
item that only left scope does not.

`(repo, number)` identifies an item. GitHub numbers PRs and issues from one
sequence per repo, so the pair is unique across both kinds. Compare `repo`
without regard to case.

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
    }
  ]
}
```

### Top Level

| Field             | Type    | Meaning                                                  |
| ----------------- | ------- | -------------------------------------------------------- |
| `version`         | integer | Contract version. `1` today. See Versioning              |
| `generatedAt`     | string  | When this file was written                               |
| `intervalSeconds` | integer | Seconds between polls                                    |
| `accounts`        | array   | One entry per configured GitHub account, in config order |
| `items`           | array   | Monitored items, sorted by `repo`, then `number`         |

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

| Field       | Type              | PR                                                                              | Issue                                       |
| ----------- | ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| `kind`      | `"pr"`, `"issue"` | `"pr"`                                                                          | `"issue"`                                   |
| `repo`      | string            | `owner/name`                                                                    | same                                        |
| `number`    | integer           | PR number                                                                       | issue number                                |
| `url`       | string            | `https://github.com/{repo}/pull/{number}`                                       | `https://github.com/{repo}/issues/{number}` |
| `account`   | string            | Login of the account that sees it                                               | same                                        |
| `client`    | string or null    | Client id configured for the repo, else for its owner; null when neither is set | same                                        |
| `state`     | enum              | `OPEN`, `DRAFT`                                                                 | `OPEN`                                      |
| `review`    | enum or null      | `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, or null                     | null                                        |
| `ci`        | enum or null      | `SUCCESS`, `FAILURE`, `ERROR`, `PENDING`, `EXPECTED`, or null                   | null                                        |
| `mergeable` | enum or null      | `MERGEABLE`, `CONFLICTING`, `UNKNOWN`                                           | null                                        |
| `sha`       | string or null    | Head commit SHA                                                                 | null                                        |
| `closes`    | integer[]         | Issue numbers in the same repo this PR closes, sorted, at most 50               | `[]`                                        |
| `since`     | string            | When gh-events first saw the item                                               | same                                        |

The `url` is built from `repo` and `number`, never copied from GitHub, so a
consumer can match it against its own tracker links in the same form.

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

| Field     | Type              | Meaning                                                               |
| --------- | ----------------- | --------------------------------------------------------------------- |
| `v`       | integer           | Line version. `1` today                                               |
| `key`     | string            | Unique id of this event; see below                                    |
| `event`   | enum              | One of the events below                                               |
| `kind`    | `"pr"`, `"issue"` | The item's kind                                                       |
| `repo`    | string            | `owner/name`                                                          |
| `number`  | integer           | PR or issue number                                                    |
| `account` | string            | Login of the account that saw it                                      |
| `client`  | string or null    | As in `registry.json`                                                 |
| `sha`     | string or null    | Head commit SHA for PR events; null for issue events                  |
| `at`      | string            | When the poll that saw the change ran, not when it happened on GitHub |

### Events

| Event            | Kind  | When                                                                                   |
| ---------------- | ----- | -------------------------------------------------------------------------------------- |
| `approved`       | pr    | `review` became `APPROVED`                                                             |
| `ci_failed`      | pr    | `ci` became `FAILURE` or `ERROR` on a head commit. A new failing commit is a new event |
| `conflict`       | pr    | `mergeable` became `CONFLICTING`                                                       |
| `merged`         | pr    | The PR was merged                                                                      |
| `issue_assigned` | issue | The account became an assignee                                                         |
| `issue_closed`   | issue | The issue was closed                                                                   |

The first poll of an account writes no events, so state that existed
before gh-events started does not flood the log. A PR whose `mergeable` was
still `UNKNOWN` at that first poll stores its first computed value without
a `conflict` event. A PR or issue that enters scope later reports its
current state, for example a new PR that already fails CI gives
`ci_failed`.

### Keys

`key` is `{repo}#{number}:{event}:{discriminator}`. The discriminator is
the head SHA for PR events, `closedAt` for `issue_closed`, and `-` for
`issue_assigned`. gh-events never writes a key twice. A consumer
de-duplicates by `key` too, so reading a line twice is harmless.

Because `issue_assigned` uses `-`, an issue that is unassigned and assigned
again gives no second event.

### Reading the Log

- The file is only ever appended to. It is **never truncated or rewritten
  in place**.
- Each poll appends whole lines in one write. A reader processes up to the
  last newline and leaves a partial last line for the next read.
- Keep a byte offset and the last `key` read.
- **Rotation is by rename.** If gh-events rotates the log, it renames
  `events.jsonl` and starts a new file at the same path. A reader that sees
  a different inode at the path finishes the old file if it still has it
  open, then reads the new file from offset 0, still de-duplicating by
  `key`. gh-events does not rotate today.
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

## Not in This Contract

- **Titles.** Never written. A consumer that needs a title takes it from its
  own records, matched by `(repo, number)`.
- **Branch names.** Never written.
- **An explicit watch list** for items the account did not author and was
  not asked to review. Planned later as a file the consumer writes and
  gh-events reads.
