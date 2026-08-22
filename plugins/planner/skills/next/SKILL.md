---
name: next
description: Pick the next task for the active client and start it, with no discussion. Resolves the client from the working directory or from a partial-name argument, chooses by the dashboard's own ordering, claims the item, and either hands to /planner:execute or refines its plan until it is executable. Pass "confirm", "ask" or "dry-run" to be told the choice and the reasoning instead of it starting. Use when the user says "/planner:next", "what next", or "start the next task".
argument-hint: [client-filter] [confirm|ask|dry-run]
allowed-tools: Bash, Read, Edit, Skill, AskUserQuestion
user-invocable: true
---

# Next Task

Answer "what do I work on now" and **begin it**, in one command, with as little
conversation as the situation allows. This is a high-frequency command: every
line it prints is a line the operator reads several times a day, so it prints
almost nothing by default.

## Operating Principle: The Dashboard Already Holds the Answer

Priority is **not inferred here**. The operator maintains it by hand, and the
rule is recorded:

> Within a client block, open tasks run most-important first — order is the
> priority signal.

So the default choice is the **first open item in the client's group**. This
skill re-orders for exactly two reasons (Step 4), and otherwise reads position
as intent. Anything cleverer fights the ordering the operator maintains, and
makes two consecutive runs disagree for reasons they cannot see.

Related: the colour markers on some items (🔴 🟡 🟢 ⚪) are **defect severity,
not priority**. Most items carry none. Never rank by them.

## Step 1: Parse the Argument

One optional argument, plus one optional mode word. Both may appear together
(`/planner:next Glob confirm`).

- **`confirm`, `ask`, `dry-run`** — all three mean the same thing: **explain
  mode**. Report the choice and the reasoning, change nothing, start nothing.
- **Anything else** — a **client filter**: a case-insensitive partial match
  against the client names in `~/.claude/obsidian.json#clients`
  (`Glob` → `Globex`). A filter is an explicit statement of intent and
  overrides the working directory.

Resolution rules for the filter:

- **One match** → that client.
- **No match** → say so and stop. Never silently fall back to the working
  directory: the operator named a client, and running someone else's work
  instead is worse than doing nothing.
- **More than one match** → ask which, via `AskUserQuestion`. This is the one
  place the low-chat rule yields, because a wrong guess starts the wrong work.

With no filter, resolve the client from the working directory exactly as
`/obsidian:dashboard` does: longest path prefix in `clients`, falling back to
`default_client`.

## Step 2: Resolve the Day

Same as [`/planner:today`](../today/SKILL.md) Step 2, including the weekend
fall-forward to Monday and the promotion of a day found only inside the
collapsed `> [!note]- Tomorrow` or `> [!note]- Future` callouts. Reuse that skill's rules rather than
restating them; a day this skill cannot see is a task it will not pick.

Run the [dashboard write protocol](../../../obsidian/rules/dashboard-write.md) before any edit: it refuses on
an iCloud conflict copy and snapshots the file first, so a later difference
can be attributed rather than guessed at. A non-zero exit stops the skill.

## Step 3: Read the Client's Group

Extract the client's `#### **<Client>**` group under the day's heading and take
its open `- [ ]` items **in file order**. Order is the priority signal, so the
order they are read in is the order they are considered.

If the client has no group under the day, or the group has no open items, say
so in one line and stop. "All done" is a valid answer and needs no ceremony.

## Step 4: Choose

Walk the items in order. Skip any item tagged `🚧`, which the operator writes
on work that waits on someone else or on a decision that is not theirs to make
right now. Report what was skipped and why; never silently pass over work.

Blocked is read from the tag only, for the same reason admin is (below): a
command that runs several times a day cannot decide from prose whether "await
the partner's schema" is still true, and a wrong read either burns the morning
on something unstartable or skips work that is ready.

Among the rest, two classes jump the queue, in this order:

1. **Admin jobs**, tagged `🧾` or `#admin` by the operator. These clear fast and
   clearing them first is the point: a morning spent on admin is a morning not
   spent on the work that needs a whole head. Take them in dashboard order.
2. **Quick wins**: an item with **no `[Details]` link**. The dashboard content
   rule is that every entry ends with a Details link and the explanation lives
   there, _"skip the details page only when the title alone is obvious"_ — so an
   item without one is, by the operator's own convention, small enough to need
   no plan. Take these in dashboard order.
3. **Everything else**, in dashboard order. The first one wins.

Admin is detected only by its tag, and so is blocked. Do **not** infer "this
looks administrative" or "this sounds blocked" from the item text: across a
hundred-odd items that guess decides the operator's morning, and it will
disagree with itself between sessions. An untagged item is available work.

## Step 5: Explain Mode Stops Here

In `confirm` / `ask` / `dry-run`, report and stop — no claim, no start:

```text
next (Globex, Monday 24 August): 🧾 Submit the August timesheet
why:  admin job, jumps the queue; 3 items ahead of it are project work
plan: none attached — small enough that the title is the plan
also: skipped "Await the partner's schema" (blocked on their reply)
```

Four lines at most: the pick, why it beat the others, the state of its plan,
and anything skipped. No options, no follow-up question.

## Step 6: Claim It

Before doing any work, mark the chosen item in place:

```markdown
- [ ] 🔄 **Submit the August timesheet** …
```

Several agents share one `Dashboard.md` and the last writer wins with no
conflict copy, so an unclaimed task is one two sessions pick at the same
moment. Claim first, work second.

Re-read the item's line immediately after writing and confirm the claim is
there. If it is not, another session wrote over it: **start again from Step 3**,
because that session has probably taken this task.

Leave the claim in place while the work runs. `/obsidian:tick` and
`/wrap:day` clear it when the item is finished; an abandoned claim is a visible
loose end, which is the point.

## Step 7: Start

Branch on what the item carries:

- **A `[Details]` link whose plan has an approved `## Test Plan`** → invoke
  [`/planner:execute`](../execute/SKILL.md) on it. That skill owns autonomous
  execution and will not run against an unapproved Definition of Done.
- **A `[Details]` link with no approved Test Plan** → **refine the plan until
  it is executable**: fill in the scope, acceptance criteria, and Test Plan as
  [`/planner:goal`](../goal/SKILL.md) defines them. Then **stop** and print one
  line saying the plan is ready and needs approval. Approving a Definition of
  Done is the operator's, and executing against one they have not seen defeats
  the gate.
- **No `[Details]` link** (a quick win) → do the work directly. It carries no
  plan because it needs none.

## Step 8: Report

Default mode prints **one line**, after the work is under way or done:

```text
started: 🧾 Submit the August timesheet (Globex) — no plan needed
```

or

```text
ready: RAG Mini server plan now has a Test Plan — approve to execute
```

Nothing else. No preamble, no summary of what the dashboard contains, no
restatement of the reasoning. The operator asked for the next task, not a
report on the deliberation. Reasoning is what explain mode is for.

## Constraints

- **Never start work for a client the operator did not choose.** A filter that
  matches nothing stops the command.
- **Never execute against an unapproved Test Plan.** Refine and stop instead.
- **Never re-order beyond Step 4's two exceptions**, and never rank by the
  colour markers.
- **Never edit an item's prose** while claiming it. Add the claim marker; leave
  every word the operator wrote.
- **Never pick a `🚧` item** to have something to do. Report the block.
- **Never add, move or remove a tag.** `🧾` and `🚧` are the operator's;
  `/obsidian:add` writes them. This skill reads them and writes only the `🔄`
  claim.
- Touch only `## Focus`. Never `## Initiatives` or `#### Other active work`.
