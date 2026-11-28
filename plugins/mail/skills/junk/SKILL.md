---
name: junk
description: |
  Triages the Junk Email folder in a Microsoft 365 mailbox: rescues wrongly
  flagged mail to the Inbox, deletes the rest (marked read, recoverable), and
  silently marks everything unread in Archive and Deleted Items as read.
  Triggers: "clean my junk", "go through junk mail", "junk triage", "check
  spam folder".
---

# Junk Triage

Scan the Junk Email folder, rescue false positives, delete the rest. The one
dangerous edge is deletion, so the run has exactly one gate and it sits in
front of it. Deletes are recoverable (Deleted Items, ~30 days) by design.

A scheduled run with nobody watching cannot pass a gate. It follows
[Unattended Runs](#unattended-runs) instead, which trades the gate for a
stricter rescue bias and drops the two steps that act outside the mailbox.

## Prerequisites

- A cached Graph device-code token with `Mail.ReadWrite` — the helper finds
  it in `~/.config/mail/` or the freeagent plugin's cache, or run
  `junkmail.py login`. The helper is `scripts/junkmail.py` in this skill's
  directory (stdlib Python 3.8+).
- **Personal rules file** (optional but the point of repeat runs): path in
  `~/.config/mail/config.json` under `"rulesFile"`, typically a note in the
  operator's own iCloud/vault storage — never inside this repo or plugin.
  Markdown with two headings the skill reads literally: `## Always rescue`
  and `## Always delete`, each a list of `sender contains:` / `subject
contains:` patterns with an optional reason.

## Step 1 — Read-Only Inventory

```bash
python3 "<skill-dir>/scripts/junkmail.py" junk --top 50
```

Load the rules file first if configured. Classify every message, rules
before judgement:

1. A rules match decides immediately (and the table says which rule).
2. Otherwise judge from sender, subject and preview: known correspondents,
   replies to the operator's own threads, receipts, invoices, calendar
   invites and account/security notices lean **rescue**; bulk marketing,
   cold outreach and phishing lean **delete**.
3. **Unsure defaults to rescue.** The cost asymmetry is total: a junk mail
   in the Inbox costs a glance; a deleted legitimate mail may never be seen.

## Step 2 — The Gate

Present one table: verdict, sender, subject, age, and a one-line reason per
message (naming the rule where one fired). Then stop. The operator approves,
or moves individual rows between rescue and delete. **No write of any kind
before the explicit yes** — the sweep included.

## Step 3 — Unsubscribe Before Deleting (legitimate brands only)

For approved-delete messages from **legitimate brands** (a business the
operator plausibly touched: known consumer/B2B brands, subscribed
newsletters), attempt unsubscribe first:

```bash
python3 "<skill-dir>/scripts/junkmail.py" unsub <id>...
```

The helper prefers the RFC 8058 one-click POST from the `List-Unsubscribe`
header (no tracking page loaded), falls back to a plain https GET, and only
reports `mailto:` targets — it never sends mail. **Never unsubscribe from
spam rings, phishing or cold outreach**: the click confirms the address is
live. Those senders go into the rules file's Always-delete list instead —
the rule is the spam control. Report each attempt's HTTP status.

## Step 4 — Act

```bash
python3 "<skill-dir>/scripts/junkmail.py" rescue <id>...
python3 "<skill-dir>/scripts/junkmail.py" delete <id>...
```

`delete` marks each message read **before** moving it, so Deleted Items
gains no unread badge. Verify from the command output counts against the
approved table; re-list the junk folder if anything disagrees.

## Step 5 — Silent Read-Sweep

```bash
python3 "<skill-dir>/scripts/junkmail.py" readsweep
```

Marks every unread message in **Archive** and **Deleted Items** as read.
Runs without its own confirmation: it moves nothing, deletes nothing, and
read-state is trivially reversible. Report the two counts.

## Step 6 — Learn

When the operator overruled a verdict, or a sender showed up that a rule
should have caught, propose one-line additions to the rules file and append
them **only on approval**. The rules file is the operator's document in
their own storage; the skill never rewrites existing lines.

## Step 7 — Log the Outcome

End every run with one entry in the skill outcome log, including a run that
stopped on a failure. Invoke the `skill-feedback:log` skill with
`--skill-dir` set to this skill's directory. If that skill is not installed,
skip this step and report `log: skipped`.

| What happened in the run                                  | `outcome`   | `mode`                   | `detected` |
| --------------------------------------------------------- | ----------- | ------------------------ | ---------- |
| The operator approved the table as shown, counts matched  | `ok`        |                          |            |
| The operator moved a row from delete to rescue            | `corrected` | `deletes-wanted-message` | `review`   |
| The operator moved a row from rescue to delete            | `corrected` | `rescues-junk`           | `review`   |
| A rescue or delete count disagreed with the approved rows | `failed`    | `count-mismatch`         | `check`    |
| No cached token, or a Graph call failed                   | `failed`    | `mailbox-unreachable`    | `check`    |

- Log one entry per run. When rows moved both ways, log
  `deletes-wanted-message`, because it is the more harmful of the two.
- `what` gives counts and never a sender, an address or a subject:
  "Proposed deleting 2 of 14 messages that the operator moved to rescue".
- `fix` is `config` when Step 6 added a rule for it, and `none` otherwise.
- When the operator finds a wrongly deleted message days later, log it by
  hand with `--detected later-use`, the date of that run, and `--run` set to
  the id of that run's entry. The log skill says how to find the id. The
  review then counts the run once, as a failure.

Report one line: `junk: <n> rescued, <m> deleted (read, recoverable),
sweep: <a>+<d> marked read, rules: <k> added, log: <outcome>`.

## Unattended Runs

A scheduled task (for example a desktop-app routine at fixed times) has no
operator to approve the gate. The operator authorises it once, when they set
the schedule up, and every run then follows these rules instead of Steps 2,
3 and 6:

- **No gate.** Classify as in Step 1 and act straight away: `rescue`, then
  `delete`, then the Step 5 read-sweep.
- **Rescue anything that is not clearly junk.** Rules decide first. Without a
  rule, delete only clear bulk marketing, cold outreach, spam and phishing.
  Receipts, invoices, calendar invites, account or security notices, replies
  to the operator's threads and anyone who could be a real correspondent are
  rescued. A wrong rescue costs one glance in the Inbox; a wrong delete may
  never be noticed.
- **No unsubscribe.** Step 3 is skipped: an unattended request to an
  unsubscribe URL can confirm the address to a sender nobody has vetted.
- **No rules-file edits.** Step 6 becomes a suggestion log. Append one line
  per proposed rule to `~/.config/mail/rule-suggestions.md` (create it if
  missing), skipping suggestions already there:
  `- YYYY-MM-DD HH:MM  sender contains: <x>  -> rescue|delete  (reason)`.
  The operator moves the ones they agree with into the rules file.
- **Counts still gate the run.** A rescue or delete count that disagrees with
  the classification stops the job, as in Failure Modes, and is reported.
- **No login.** Without a cached token, report it and stop; device-code
  login needs a person.
- **The run is still logged.** Step 7 applies. With no gate there is no
  operator correction to record, so the outcome is `ok` unless a count or
  the mailbox stopped the run. The entry stays in the local log, and the log
  skill leaves the shared copy to a later attended run.

Report the usual one line, plus `suggestions: <k> logged`. The caller decides
whether to notify; a rescued message or any failure is worth a notification,
a run that only deleted junk is not.

## Failure Modes

- No cached token → print the `login` instruction and stop.
- Rules file configured but unreadable → say so and continue with judgement
  only; never guess at missing rules.
- A rescue or delete count that disagrees with the approved table → stop and
  re-list before touching anything else.
