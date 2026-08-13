---
name: archive
description: Move completed dashboard items into the monthly work log, across every client. A client group with nothing left open moves entirely; a day with no groups left loses its heading. Silent — reports only "Done" or "No items found to archive". Use when the user says "/planner:archive", "archive done items", or "clear the dashboard".
user-invocable: true
allowed-tools: Bash
---

# Planner: Archive

Clear finished work off the dashboard so what is left is what is left to do.

Unlike every other planner skill, this one is **not scoped to the current
repo's client**. A day's work spans clients, and clearing only one of them
leaves the day half-tidied. It runs across all of them.

## Run It

```bash
bun "<skill-base-dir>/../../scripts/archive-done.ts"
```

That is the whole skill. The script does the work; this file exists to say
what it does and what it will not do.

Flags: `--dry-run` reports without writing, `--verbose` lists each day and
client touched. Neither is the default: the point of the skill is silence.

## Output

Exactly one line, and nothing else:

- `Done`
- `No items found to archive`

No tables, no summary of what moved, no narration before or after. If the
operator wants the detail they will ask, or read the work log. Reporting
volume is the thing this skill is trying to reduce.

An error is the exception: a missing dashboard, an unparseable day heading, or
an iCloud conflict copy stops the run and says so. Never edit a dashboard that
has a conflict copy beside it: two versions disagree and the write picks a
winner silently.

## What Moves

Three levels, each following from the last:

1. **A ticked `- [x]` item** moves to the archive, wherever it sits.
2. **A client group with no checkbox items left** moves entirely: heading,
   intention callout, handover links, topical paragraphs. An empty group is
   noise on a worklist, and its prose belongs with the work it describes.
3. **A day with no client groups left** loses its heading too.

A group keeps its place when anything is still open: only the ticked lines
leave, and the prose around them is untouched.

## Where It Goes

`Archive/Work Logs/<year>/<Month>.md`, created with work-log frontmatter if
absent. The month comes from the day heading being archived, the year from
today, so archiving a December day in January needs the year checked by hand.

The archive uses a different shape from the dashboard, and the script
translates: a dashboard `### <Day>` becomes an archive `#### <Day>`, and a
dashboard `#### **<Client>**` becomes a plain `**<Client>**` paragraph. Days
run **newest first** there, the reverse of the dashboard. An entry for a day
that already exists is merged into, not duplicated.

## Rules

- **Every client, every day** in `## Focus`, including today. Today's completed
  work is still completed; the intention callout stays behind, so the day's
  narrative survives the items leaving.
- **Idempotent.** A second run with nothing ticked writes nothing and says
  `No items found to archive`.
- **Never ticks, never deletes.** Nothing is marked done for the operator, and
  nothing leaves without landing in the archive first.
- **Outside `## Focus` is untouched**: the maintain callout, `## Initiatives`,
  and anything else below.
- **An orphaned topical paragraph is left alone.** When a run's items all move
  but the group stays, the bold paragraph that framed them remains. It is the
  operator's prose, and the rule against rewriting it outranks the tidying.
