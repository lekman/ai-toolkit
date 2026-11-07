---
name: report
description: Report what was done in a time window for one or more clients, from the task database's log, state changes, pull requests and Details pages. Use when the operator asks "what did I do last weekend for X", "what was done here", "what happened on X last week", or needs evidence to answer a customer's question about past work.
---

# Report What Was Done

The task database holds the evidence for past work: each task's log notes,
its state changes with who made them, its pull requests, its tracker ticket
and its Details page. `tasks report` collects that evidence for a time window
and the clients you name. Answer from the report, not from memory.

## Run the Report

1. Find the client id with `tasks clients` when the operator names a client
   by its name.
2. Choose the window. `--from` takes a day or a period; `--to` is the last
   day and defaults to the end of what `--from` names:

   | The operator asks          | Pass                                   |
   | -------------------------- | -------------------------------------- |
   | "today", "yesterday"       | `--from today`, `--from yesterday`     |
   | "last weekend"             | `--from last-weekend`                  |
   | "this week", "last week"   | `--from this-week`, `--from last-week` |
   | "last month"               | `--from last-month`                    |
   | "on 31 October"            | `--from 2026-10-31`                    |
   | "since 1 October"          | `--from 2026-10-01 --to today`         |
   | "between 1 and 15 October" | `--from 2026-10-01 --to 2026-10-15`    |

3. Run it, with `--client` once per client:

   ```bash
   tasks report --from last-weekend --client acme
   ```

   Add `--format json` when another tool reads the result.

Days and times are Europe/London. A week runs Monday to Sunday, and
`last-weekend` is the Saturday and Sunday before the current week, so on a
Saturday it is the weekend before, not today.

## Answer From It

- For each task, say what was done in plain language: the outcome first,
  then the evidence. Name the tracker key and link the pull requests, so the
  reader can check.
- Use only what the report shows. A log note is evidence; a title alone says
  what was planned, not what was done.
- An answer meant for a customer covers that customer's client only. Never
  run the report for several clients and paste it into a message to one of
  them.
- The report shows `now <state>` for each task. Say whether the work is
  finished, in review, or still going.

## When the Report Looks Thin

- "0 had activity" is a claim. Check the client id and the window before you
  repeat it. The report says how many tasks it read; if that is 0, the client
  id is wrong.
- The log is as complete as the agents kept it. Work before the trace hooks
  can have state changes and no notes. Say what is missing rather than fill
  the gap.
- **Incomplete** means a client has more than 200 tasks in one state and the
  server returned only 200. Report it to the operator: the answer may miss
  work.
- Read a task's Details page (its `detailsId`) when the log alone does not
  explain what was done.

## Gaps

The last section lists tasks with activity in the window and no Details page.
Tell the operator about them. For a task you worked on yourself, offer to
write the page and set its `detailsId` with
`tasks --by <your session name> set <id> --details <page>`.

## For One Task

For "what was done on ACME-7", find the task with
`tasks search --key ACME-7 --state todo --state doing --state review --state approved --state merged --state done`,
then `tasks show <id>` for its whole log, pull requests and Details page.
Use the report when the question names a time window.
