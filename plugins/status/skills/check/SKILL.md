---
name: check
description: Check whether the services the operator depends on (Microsoft 365, GitHub, Claude, Cloudflare, Google Workspace, AWS, FreeAgent and their own endpoints) are in an outage, from each provider's official status feed. Use when the user says "/status:check", "is X down", "is there an outage", or "check my services". Also use, without being asked, when calls to an external service fail with 5xx errors, timeouts or a disconnected connector two or more times in a row, before retrying again or debugging the caller.
user-invocable: true
---

# Check Service Status

A failing call to an external service is often the provider's outage, not a
bug. This skill checks the providers' own status feeds before you retry or
debug, so you can stop and say "Microsoft 365 is down" instead of trying again
and again.

All the work is one script with no dependencies:

```bash
STATUS="bun <skill-base-dir>/../../scripts/cli.ts"
```

## Step 1: Run the Check

```bash
$STATUS                      # every configured service
$STATUS --only microsoft     # the services whose names contain a word
$STATUS --json               # the same results as JSON
$STATUS --list               # the configured services and their feeds
```

When the check follows a failure, pass `--only` with the failing service's
name. When the user asks in general, run it with no filter.

The exit code says what it found:

| Exit | Means                                                         |
| ---- | ------------------------------------------------------------- |
| 0    | Nothing affected (maintenance counts as unaffected)           |
| 1    | At least one service is degraded or in an outage              |
| 2    | Bad arguments or services file: the message names the problem |
| 3    | Nothing affected, but at least one feed couldn't be read      |
| 4    | This machine is offline: nothing answered at all              |

## Step 2: Report

- **Exit 0**: say so in one line. The failure is not a known outage, so carry
  on with normal debugging.
- **Exit 1**: name each affected service, its level, the provider's own words
  from the report, and the status page link. If the affected service is the
  one the current task depends on, **stop retrying** and tell the user the
  work waits on the provider. Offer to record what is blocked so it can resume.
- **Exit 3**: say which feed couldn't be read. That says nothing about the
  service itself.
- **Exit 4**: the user's own connection is down, not the services. Say so,
  and repeat the connections the report lists (status page and phone line),
  so the user can check them from a phone on mobile data. Stop retrying any
  network call until the user says the connection is back.

A provider's page can lag its outage by several minutes, and a status page
says nothing about a fault in your own tenant or account. So "ok" means no
known outage, not that the service works for you.

## Setup

The services live in `~/.config/status/services.json` (or `$STATUS_CONFIG`).
Without it the script uses `services.example.json` beside it and says so.
If the user has no file, copy the example there and tell them to edit it. See
the plugin README for each kind's fields.

## Rules

- Never scrape Downdetector or similar crowd-report sites. They block scripts
  (downdetector.com and downdetector.co.uk answered with a Cloudflare bot
  challenge on 13 Nov 2026), their terms forbid it, and getting past a bot
  challenge is not allowed.
- Read-only: the check only makes GET requests.
