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

Report one line: `junk: <n> rescued, <m> deleted (read, recoverable),
sweep: <a>+<d> marked read, rules: <k> added`.

## Failure Modes

- No cached token → print the `login` instruction and stop.
- Rules file configured but unreadable → say so and continue with judgement
  only; never guess at missing rules.
- A rescue or delete count that disagrees with the approved table → stop and
  re-list before touching anything else.
