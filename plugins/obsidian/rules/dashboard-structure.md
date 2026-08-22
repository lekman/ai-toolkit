# The Shape of Dashboard.md

Where a day lives, what a day contains, and how days move. Written once here
and referenced by every skill that reads or writes the dashboard.

## `## Focus` Holds Three Bands

```markdown
## Focus

### Saturday 22 August <- today, unprefixed

#### **Acme**

- [ ] …

> [!note]- Tomorrow <- exactly one day, collapsed
>
> ### Monday 24 August
>
> #### **Acme**
>
> - [ ] …

> [!note]- Future <- every later day, collapsed, chronological
>
> ### Tuesday 25 August
>
> …
```

- **Today** is the unprefixed section. It is the only one, and its absence is
  what triggers a day shift.
- **Tomorrow** holds **exactly one day** — never two, never zero. Planning
  tomorrow is a different act from planning the week, and it deserves a band
  you can open without the other six days in the way.
- **Future** holds every later day, in chronological order.

Every line inside a callout carries a `"> "` prefix: day headings
(`> ### Monday 24 August`), client groups, checkboxes, and blank lines as a
lone `>`. **An unprefixed blank line ends the callout** and spills the rest of
the days into the body, so reading strips exactly one `"> "` level and writing
restores it.

## Tomorrow Is the Next Working Day

Resolve in this order:

1. The next calendar day, if it is Mon–Fri.
2. Otherwise the next weekend day **that already has items** — weekend work
   happens, and a Saturday with tasks on it is a working day.
3. Otherwise the next Mon–Fri day.

So on a Friday with an empty weekend, tomorrow is Monday; on a Friday with
Saturday tasks, tomorrow is Saturday.

**The Tomorrow callout stays in the file even when that day has no items.**
An empty band is a stable anchor for the twelve skills that look for it; a
conditional one is twelve places that each have to decide what its absence
means.

## A Day Contains Client Groups

Day headings are `##` or `###`. Inside a day, **client groups are `####`
subheadings** (`#### **Acme**`), and an item belongs to the group it sits
under — the item text carries no client name.

So **a day's section ends at the next heading of 2–3 hashes**. A `####` line is
a group boundary inside the day, never the end of it. Extraction that stops at
the first `####` sees one client and reports the day as nearly empty.

Within a group, **open items run most-important first**. Order is the priority
signal, maintained by the operator. Read it as intent; never re-rank without
being asked.

## Markers

| Marker        | Meaning                                       | Written by                |
| ------------- | --------------------------------------------- | ------------------------- |
| `🧾`          | administrative job — clears fast, taken first | `/obsidian:add --admin`   |
| `🚧`          | blocked, waiting on someone else              | `/obsidian:add --blocked` |
| `🔄`          | claimed by a running session                  | `/planner:next`           |
| `🔴 🟡 🟢 ⚪` | defect **severity**, not priority             | the operator              |

State that changes what a command does is **tagged, never inferred**. A command
run several times a day cannot re-read prose and decide differently than it did
yesterday. An untagged item is available work.

## The Day Shift Is Two Stages

When today's section is archived and the unprefixed band is empty:

1. **Tomorrow → today.** Cut the day out of the Tomorrow callout, strip one
   `"> "` level from every line, and place it unprefixed under `## Focus`.
2. **Earliest Future day → Tomorrow.** Cut it out of Future, and re-insert it
   inside the Tomorrow callout at the same prefix depth.

Both stages run, in that order, or the bands end up holding the wrong days.
If Future is empty, stage 2 leaves an empty Tomorrow callout — which is correct,
not a failure.

## A Missing Tomorrow Band Is Created, Not Assumed

A dashboard written before this structure has no `> [!note]- Tomorrow` callout
at all. Any skill that needs the band **creates it** — an empty callout
immediately above the `> [!note]- Future` line — rather than failing or writing
into Future instead:

```markdown
> [!note]- Tomorrow

> [!note]- Future
```

Then, if Future's earliest day is the day that "tomorrow" resolves to, move it
into the new band. This makes the structure self-healing: the first skill to
touch a dashboard migrates it, and no separate migration step exists to be
forgotten or run twice.

Creating the band is the one exception to "never restructure the operator's
file". It adds an empty container and moves at most one day that was already
scheduled for that date; it never changes an item, a word, or an order.

## Rules

- **Never create a second unprefixed day.** One today, always.
- **Never put two days in Tomorrow.** A second day belongs in Future.
- **Never remove the Tomorrow callout**, empty or not.
- **Never write to a past day.** A day that has happened is a record.
- **Never reorder items** except where a skill's own contract says it may, and
  then only with the operator's confirmation.
- Writing follows [the write protocol](dashboard-write.md): guard, write,
  verify.
