---
name: notify
description: Push a message to the operator's phone through Pushover, at most once per key every threshold window, and track questions the operator has not answered so they are pushed even while the commander session is blocked. Used by /commander:nudge and for every question the commander asks with notify ask. Use when the user says "/commander:notify", "push this to my phone", "ping me", or "tell me on my phone".
user-invocable: true
---

# Notify

The commander's text reaches the operator only while they watch the
terminal. This skill pushes to their phone instead, through the
[Pushover API](https://pushover.net/api).

Everything goes through one script:

```bash
NOTIFY="bun <skill-base-dir>/../../scripts/notify.ts"
```

It reads `PUSHOVER_APP_TOKEN` and `PUSHOVER_USER_KEY` from the environment.
Never print them, write them to a file, or put them in a message.

## Send a Push

```bash
$NOTIFY send --key <key> --title "<title>" --message "<one line>" \
  [--url <link> --url-title "<label>"] [--priority -2|-1|0|1] [--dry-run]
```

- **The key deduplicates.** The same key sends at most once per threshold
  window (30 minutes by default). Name it after the state, for example
  `agent:<name>:stuck` or `decision:<id>`, so one state gives one push.
- **Clear the key when the state changes**, so the next occurrence pushes
  again: `$NOTIFY clear --key <key>`, or `--prefix agent:<name>:` for every
  state of one agent.
- **A failed push is never silent.** Exit 1 means Pushover refused it or could
  not be reached, and exit 2 means the credentials or arguments are missing.
  The reason is on stderr. Report it to the operator in the session.
- `--dry-run` prints the request with the credentials masked, and sends
  nothing.

The script cuts title and message to Pushover's limits. It refuses priority 2,
which needs retry handling the script does not do.

## Questions the Operator Has Not Answered

The commander never asks with `AskUserQuestion`: it blocks the session, and
while it waits nothing is relayed. The plugin's `no-ask` hook refuses it in the
commander and its roster workers. Ask through the pending list instead, and
carry on with other work:

```bash
$NOTIFY ask --key <key> --question "<the question in one line>" \
  --options '[{"label":"Yes","recommended":true},{"label":"No"}]'
# ... the answer arrives later as a dash request with action "answer" ...
$NOTIFY answered --key <key>
```

`--options` is optional: up to four `{label, description?, recommended?}`.
The Atlas sidebar shows the question under Waiting on you with those choices
and an Other box. A closed question without options gets yes or no, once or
for all future requests. An answer with `always: true` is a standing rule.

`ask` records the question in `pending.json` and starts a detached timer, an
operating-system process outside the session. When the threshold passes and
the question is still pending, the timer pushes it. `answered` removes it, and
a timer that fires later finds it gone and does nothing. Use the same key for
both calls, for example `plan-check:<date>` or `dispatch-owner:<task>`.

The nudge loop runs `$NOTIFY due` on every tick as a backstop. It pushes any
pending question past the threshold, which covers a timer lost to a restart or
held by quiet hours.

## Settings

The roster's `notify` block, all optional:

```json
"notify": {
  "enabled": true,
  "threshold_minutes": 30,
  "quiet_hours": { "start": "22:00", "end": "07:00" }
}
```

- `enabled: false` turns every push off. The script exits 0 and says so.
- `threshold_minutes` is both the dedupe window and how long a question waits
  before it is pushed.
- `quiet_hours` is off unless set. Inside the window a push is held, not
  recorded, so the next attempt after the window sends it.

## Files

- `~/.claude/commander/notify.json`: when each key last sent.
- `~/.claude/commander/pending.json`: questions waiting on the operator.
- `~/.claude/commander/notify.log`: one line per push, dry run and timer
  outcome. No credentials.
