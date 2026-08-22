---
name: pull
description: Pull tomorrow's work forward when today is done. Finds the next task in the Tomorrow band for the active client, moves it into today, and starts it. Same selection rules and same argument contract as /planner:next. Use when the user says "/planner:pull", "I'm done for today, what else", or "pull something forward".
argument-hint: [client-filter] [confirm|ask|dry-run] [--force]
allowed-tools: Bash, Read, Edit, Skill, AskUserQuestion
user-invocable: true
---

# Pull Tomorrow's Work Forward

For the moment today's list is empty and there is still working time left.
Takes the next task out of the `> [!note]- Tomorrow` band, moves it into today,
and starts it.

This skill owns **the move**. It owns neither the choosing nor the doing:
[`/planner:next`](../next/SKILL.md) Step 4 defines which item is next, and
`/planner:next` Step 7 defines what starting it means. Those rules are
referenced, never repeated — two copies of a selection rule is how
`obsidian:today` ended up filtering on a convention the vault had abandoned.

## Step 1: Parse the Argument

Identical contract to `/planner:next` Step 1:

- **`confirm`, `ask`, `dry-run`** — explain mode: report the choice and stop.
- **Anything else** — a case-insensitive partial-match client filter that
  overrides the working directory. No match stops the command; more than one
  match asks.
- **`--force`** — pull even though today still has open items (Step 3).

## Step 2: Guard the Write

Run the [dashboard write protocol](../../../obsidian/rules/dashboard-write.md)
before any edit. A non-zero exit stops the skill.

## Step 3: Check That Today Is Actually Done

Read the client's group under today's heading. If it still has open `- [ ]`
items that are not tagged `🚧`, **stop**:

```text
today still has 3 open items for Globex — finish those first, or pass --force
```

Pulling tomorrow's work while today's is unfinished is how a day's plan stops
meaning anything. Blocked items do not count: a group holding nothing but `🚧`
items is done as far as the operator can act on it.

## Step 4: Choose from Tomorrow

Read the client's `#### **<Client>**` group inside the `> [!note]- Tomorrow`
callout, stripping one `"> "` level. Apply **`/planner:next` Step 4 unchanged**:
skip `🚧`, take `🧾` admin first, then items with no `[Details]` link, then file
order.

If Tomorrow holds no group for this client, or none of its items are available,
say so in one line and stop. Never reach into Future for something to do —
that is two days of plan reordered to fill an afternoon, and it is the
operator's call, not this skill's. Suggest `/planner:triage` instead.

## Step 5: Explain Mode Stops Here

```text
pull (Globex): 🧾 Submit the August timesheet
from: Monday 24 August — 4 items left there after this
why:  admin job, jumps the queue
today: clear, 2 ticked
```

## Step 6: Move It

One move, in this order:

1. Cut the item's line out of the Tomorrow band.
2. Strip exactly one `"> "` level.
3. Insert it at the end of the client's group under **today's** heading,
   creating the `#### **<Client>**` group if the day has none — same placement
   rules as [`/obsidian:add`](../../../obsidian/skills/add/SKILL.md) Steps 4
   and 5, including never landing after a trailing prose paragraph.
4. Carry `🧾`, `🚧` and severity markers with it. Do not add a `🔄` claim here;
   Step 7 does that.

**Move it, never copy it, and never do it in place.** Work done today under
tomorrow's heading makes the record lie about when it happened, and the day it
was pulled from silently keeps an item nobody will do. The dashboard is the
record as much as the plan.

If the Tomorrow band is left with no items for that client, remove the empty
`#### **<Client>**` group but **keep the day and the callout** — the band
always survives, empty or not.

Re-read the moved line in both places and confirm it is gone from one and
present in the other. A half-finished move is worse than no move.

## Step 7: Start It

Hand to [`/planner:next`](../next/SKILL.md). The item is now the client's only
available work today, so `next` will select it, claim it with `🔄`, and either
execute its plan or refine it — all by its own rules.

Do not reimplement any of that here. If `next` would refuse — an unapproved
Test Plan, for instance — let it refuse and report what it said.

## Step 8: Report

One line in default mode:

```text
pulled: 🧾 Submit the August timesheet (Globex, from Monday 24 August) — started
```

## Constraints

- **Never pull while today has unfinished work**, unless `--force`.
- **Never pull from Future.** Only the Tomorrow band.
- **Never pull more than one item per run.** Capacity is judged by the operator,
  one task at a time; a run that empties tomorrow into today is not planning.
- **Never leave the Tomorrow callout absent or holding two days.**
- **Never edit item wording** while moving it.
