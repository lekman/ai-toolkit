---
name: plan-check
description: Send the day-plan check to the owner session of every client on today's dashboard in one command, then bring the replies together so the operator can agree each client's plan and release the queued tasks. Safe to run again; a second run sends nothing new and reviews the replies. Use when the user says "/commander:plan-check", "check today's plans", "send the plan checks", "morning check with all clients", or after /planner:today at the start of the day.
user-invocable: true
---

# Plan Check

Run the day-plan check from `/commander:dispatch` Step 3 for every client on
today's dashboard at once. The operator types one command in the morning and
agrees each client's plan before any task goes out.

The skill has two passes. The first run sends the checks. Replies arrive
later, and a skill cannot wait for them, so a later run reviews the replies
that have come in. Every run sends any check that is missing, then reviews any
reply that is waiting. A run with nothing to send and nothing
to review says so in one line.

## Step 1: Read Today's Client Groups

Resolve the dashboard and today's heading the way `/planner:today` does
(Steps 1 and 2 there), including promoting today out of the Tomorrow band.
Then list the `####` client groups under today's heading:

```bash
awk -v d="$DAY" '
  $0 ~ "^#{2,3} +"d" *$" { f=1; next }
  f && /^#{2,3}[^#]/ { exit }
  f && /^####/ { gsub(/[#*]/,""); sub(/^ +/,""); sub(/ +$/,""); print }
' "$DASHBOARD"
```

A group whose items are all ticked still gets a check, because the third
question (what to pull in from later days) still applies.

If today has no heading, say so and stop. Planning the day is
`/planner:today`'s job, not this skill's.

## Step 2: Map Each Client to Its Owner

```bash
ROSTER=~/.claude/commander.json
jq '.agents' "$ROSTER"
jq -r '.out_of_scope_clients[]?' "$ROSTER"
```

Match the group name to an agent's `client`, ignoring case. Pick the owner in
this order:

1. One agent has that client → it.
2. Several do → the one whose `owns` covers engineering (for example
   `all <client> engineering`, or engineering on named repositories). Apply
   this whether or not the agents are `always_on`.
3. Still several → the `always_on` one.

A group is a **gap** when no agent matches, when the rule above leaves more
than one, or when the client is in `out_of_scope_clients`. Send nothing for a
gap. List it in the Step 5 report with the reason, so the operator can fix the
roster or run the check by hand.

## Step 3: Skip Clients Already Checked

Read the ledger. An owner that already has a plan-check row for today (see
`/commander:dispatch` Step 3) gets no second check. Its row goes to the review
in Step 6 instead.

## Step 4: Send the Checks

For each owner without a check today, follow `/commander:dispatch` with the
Step 3a brief as the message:

- Step 2 decides whether it can be sent. An owner that is not running is
  recorded as `queued`, and its start command goes in the Step 5 report as a
  Do item.
- Steps 5 and 6 send and record it, one row per owner.

Send them one after another. Each takes the next id, so the ledger reads in
the order the checks went out.

## Step 5: Report

One line per client group, in dashboard order:

```text
Plan checks for Tuesday 29 September
- Acme → Acme: H-0929-1 sent
- Globex → Globex: H-0929-2 reply waiting (DECISION: 2 changes proposed)
- Initech: out of scope, not sent
- Hooli: gap, no roster agent for this client
```

Then a **Do** list with a start command for each queued owner, if there is
one.

## Step 6: Review the Replies

For each plan-check row in `decision`, in dashboard order, show the client and
the worker's proposed changes, then ask with `AskUserQuestion`, one question
per client:

- **Agree as proposed (Recommended)** → the changes are applied as the worker
  listed them.
- **Agree, no changes** → the dashboard stays as it is.
- **Amend** → the operator says what to change through the built-in "Other"
  option.

Wrap the call in `notify ask --key plan-check:<date>` and `notify answered`
(see `/commander:notify`). The session is blocked while the question is open,
and the detached timer is what reaches the operator's phone if they do not
answer within the threshold.

Put up to four clients in one `AskUserQuestion` call. A row still in `sent` is
not reviewed. The report shows it as waiting.

## Step 7: Apply and Release

For each client the operator agreed:

1. **Apply the agreed changes to the dashboard**, one client after another,
   following the
   [dashboard write protocol](../../../obsidian/rules/dashboard-write.md).
   Run the guard first. It refuses on an iCloud conflict copy and snapshots
   the file. Then make only the agreed edits inside that client's group:
   - tick items that are done;
   - remove items the operator agreed are moot;
   - reorder the open items into the agreed order;
   - move pulled-in items from the Tomorrow or Future band, or from
     Unscheduled, into today's group, removing the `>` quote prefix as
     [the dashboard structure](../../../obsidian/rules/dashboard-structure.md)
     describes;
   - move an item to a later day in the Tomorrow or Future band, adding the
     `>` quote prefix and ending the item with `*(moved from <day>)*`;
   - add a dated state note to the end of an item, such as
     `· **29 Sep, plan check:** waiting on the review`.

   Item wording belongs to the operator. When a worker proposes rewriting an
   item, add a dated state note with the new facts and leave the wording as it
   is.

   Re-read the lines afterwards to confirm the write held. The commander makes
   these edits, not the workers, because several sessions writing
   `Dashboard.md` at once overwrite each other. `/planner:triage` does not fit
   here, because it proposes its own order and only moves items out of a day.

2. **Release the client's queue** with `/commander:dispatch` Step 3b. The
   first released brief says the plan was agreed and applied, so the worker
   starts from the current dashboard.

If the guard refuses, stop applying, report what it said, and release
nothing for that client. A task sent against a plan that was not written down
is what the check is there to prevent.

## Constraints

- Change the dashboard only in Step 7, and only with changes the operator
  agreed.
- Send tasks only by releasing a queue through dispatch Step 3b, after the
  client's plan is agreed. This skill sends no new task.
- Do not change the roster. A gap is reported, not fixed.
