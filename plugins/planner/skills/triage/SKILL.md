---
name: triage
description: Reorder and rebalance planned work. With no argument, reorders one day and offers to move what does not fit; with a weekday name, that day; with "week", spreads the working week by deadline and load. Always proposes and never writes unconfirmed, because it changes the priority signal every other skill reads. Use when the user says "/planner:triage", "reprioritise today", or "spread the week".
argument-hint: [today|tomorrow|<weekday>|week] [client-filter] [--all]
allowed-tools: Bash, Read, Edit, Skill, AskUserQuestion
user-invocable: true
---

# Triage a Day or a Week

Reorder what is planned, and move what does not fit.

## Operating Principle: This One Asks

Every other planning skill **reads** the order of a client's items and treats
it as the operator's priority signal. This skill **changes** it. So its
contract is the inverse of [`/planner:next`](../next/SKILL.md): next acts
silently and explains on request; triage **always proposes and never writes
until the operator accepts.**

That is not caution, it is the division of labour. Priority is a judgement
about what matters, made by the person accountable for it. An agent that
quietly reorders the list has replaced that judgement with a guess, and every
skill downstream will then act on the guess as though it were the operator's
intent.

## Step 1: Parse the Argument

Two positional arguments in any order, both optional:

- **A scope word** — `today` (default), `tomorrow`, a weekday name
  (`monday`…`sunday`), or `week`.
- **Anything else** — a case-insensitive partial-match client filter, same
  rule as `/planner:next` Step 1. No match stops the command.

`--all` triages every client's group in scope rather than one.

A weekday name resolves to the **next** occurrence of that day, today
included. `week` means the current working week from today to Friday, plus any
weekend day that already has items —
[the dashboard structure](../../../obsidian/rules/dashboard-structure.md)
defines that rule; do not re-derive it.

## Step 2: Guard the Write

Run the [dashboard write protocol](../../../obsidian/rules/dashboard-write.md)
before any edit. Read-only until the operator accepts, but the snapshot is
taken up front: this skill rewrites order across a whole day or week, which is
the largest edit any skill makes to this file.

## Step 3: Measure the Load

For each day in scope, count:

- **Open items** in the client's group, excluding `🚧` blocked ones — blocked
  work occupies no time.
- **Committed calendar hours**, from `/planner:today` Step 4 and 4b. Reuse that
  skill's fetch; do not query calendars directly here. No calendar available →
  say the load figure counts items only, rather than presenting a partial
  number as a whole one.

A day is **busy** relative to the others in scope, not against an absolute
capacity: this skill has no idea how long an item takes, and pretending
otherwise would be inventing precision.

## Step 4: Propose

### Day Scope

Two proposals, presented together:

1. **A reordering** of the client's open items. Justify every move against
   something in the file — a `📅` date, an item another one blocks, a `🧾`
   admin job that clears in minutes. **An item you cannot justify moving stays
   where the operator put it.** No move is the default, not a failure.
2. **What to offload**, if the day is the busiest in scope: the items to push
   to a named later day, lowest-priority first, never a `📅`-dated item whose
   date falls on or before that day.

### Week Scope

Spread the week's items across its days:

1. **`📅`-dated items first.** An item is placed on or before its date, and
   never after it. Two items competing for the same day: the earlier date wins.
2. **Everything else load-balances** across the remaining space, keeping each
   client's relative order intact — spreading is not reordering.
3. **Days already heavy with meetings get fewer items.** A day with five hours
   of calls is not a day for three large tasks.

**Dated items are a minority.** Most items carry no `📅`, so most of a week's
spread is load-balancing, and the proposal says so rather than implying a
deadline-driven plan that does not exist.

## Step 5: Present and Confirm

Show the proposal as a diff of intent, not a wall of prose:

```text
Monday 24 August — 7 items, 3.5h of meetings (busiest in scope)
  1 ↑  🧾 Submit the timesheet          admin, clears in minutes
  2 =  Draft the workshop programme     📅 2026-08-26
  3 ↓  Rewrite the onboarding guide     no date, nothing waits on it
  →    Review the schema proposal       move to Wednesday 26 August
  ⏸    Await the partner's reply        🚧 blocked, not counted

unchanged: 2 items
```

Then ask via `AskUserQuestion`: accept all, accept the reordering only, accept
the moves only, or reject. Rejection is a normal outcome and writes nothing.

## Step 6: Apply

Only what was accepted. Each move follows the same placement rules as
[`/obsidian:add`](../../../obsidian/skills/add/SKILL.md) Steps 4 and 5, and
each item keeps its markers, its text and its `[Details]` link byte for byte.

Re-read the affected groups afterwards and confirm the order matches what was
accepted. Report one line per change.

## Constraints

- **Never write without an explicit acceptance.** Not for one item.
- **Never reorder across clients.** Order is a signal within a client's block.
- **Never move a `📅` item past its date**, and never move an item onto a past
  day.
- **Never move a `🔄` claimed item** — a session is working on it now.
- **Never invent a `📅` date**, and never treat a missing one as "no deadline";
  it means the operator did not record one.
- **Never edit item wording** to make it fit a day.
- **Never touch `## Initiatives`** or a day outside the requested scope.
