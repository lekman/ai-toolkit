# Planner

Planning over an Obsidian vault, at four time scales: the next task
(`/planner:next`), the day (`/today`), the repo (`/planner:plan`,
`/planner:sync`), and one goal (`/planner:goal`, `/planner:execute`). Where the [obsidian plugin](../obsidian/README.md) owns
the mechanics of the dashboard (add, tick, wrap up), planner owns what goes on
it and what "done" means.

All planning state lives in the vault, never in a repo: a master note per repo
(`<Initiatives>/<repo> — Master Plan.md`) for _where the work stands_, and a
subpage per initiative (`<Initiatives>/<repo>/<kind>/<key>-<slug>.md`) for the
scope, acceptance criteria and Test Plan. The dashboard links to the subpage;
the repo holds code and shipped documentation only.

## Why Next Does Not Rank Tasks

The operator orders each client's items by hand, most important first, and that
order _is_ the priority signal. A ranking pass would fight it: the same command
would choose differently on two consecutive runs, for reasons that are not
visible in the file. So `/planner:next` reads position as intent and re-orders
for exactly two reasons — a `🧾` admin tag, and the absence of a `[Details]`
link, which by the dashboard's own content rule means the title alone is the
whole task.

The colour markers some items carry (🔴 🟡 🟢 ⚪) are **defect severity, not
priority**, and most items carry none at all. Nothing ranks by them.

State that changes what the command does is **tagged, never inferred**: `🧾`
for an administrative job, `🚧` for work waiting on someone else. A command run
several times a day cannot afford to re-read prose and decide differently than
it did yesterday, so an untagged item is simply available work. `/obsidian:add`
writes both tags; `/planner:next` only reads them, and writes nothing but the
`🔄` claim it clears through `/obsidian:tick` and `/wrap:day`.

## Why a Separate Skill

Sessions asked "what's my plan" tend to reach for calendars or a knowledge
index first, and both give confidently wrong answers, because task state
lives only in the tracker. Calendars know meetings, not tasks; a retrieval
index is always stale for state (which is why `Dashboard.md` is deliberately
excluded from indexing). The skill hard-codes the source order: dashboard
first, retrieval and calendars as supplements only.

## Commands

- `/planner:next`: pick the next task for one client and start it, with no
  discussion. The dashboard's own ordering is the priority signal, so it takes
  the first open item, moving only `🧾` admin jobs and items with no
  `[Details]` plan ahead of it, and skipping anything tagged `🚧` as blocked. Claims the item before working, because several
  agents share one dashboard. Pass `confirm`, `ask` or `dry-run` — all the same
  thing — to be told the choice and the reasoning instead of it starting.
- `/planner:plan`: create or update the current repo's master-plan note in
  the Obsidian vault. State (backlog tables, status balls) lives only in the
  vault; repos keep detail pages. Client and tracker (Jira / GitHub / Monday /
  none) resolve silently from cwd via `scripts/resolve-context.ts` and the
  `planner` block in `~/.claude/obsidian.json`. Monday needs
  `monday: {account, board}`: `account` is the subdomain, and without it no
  item URL can be built.
- `/planner:sync`: reconcile that note against merged PRs and closed
  tickets: move finished rows to Done, report drift, change nothing else.
- `/planner:goal` + `/planner:execute`: the goal workflow (moved here from
  the retired goal plugin): agree a Definition of Done as a `## Test Plan` in
  the initiative's subpage, link it from the dashboard (ticket link first,
  `[Details](path)` last), then execute it autonomously to a validated result.
- `/planner:archive`: move completed items off the dashboard into
  `Archive/Work Logs/<year>/<Month>.md`, across **all** clients. A client
  group with nothing left open moves entirely; a day with no groups left
  loses its heading. Deliberately silent: it prints `Done` or
  `No items found to archive` and nothing else, because the point is to
  reduce what there is to read.
- `/today`: the day's open items across **all** clients, grouped per
  client. Rules it encodes:
  - **Weekend fall-forward**: on Saturday or Sunday with nothing (or
    everything ticked) for the day, it shows next Monday's plan, labelled
    as such.
  - **Open items only**: ticked tasks are hidden unless `--done` is passed.
  - **Clients never vanish**: a group whose items are all ticked renders as
    `All done ✅ (n ticked)` instead of being dropped.
  - `--client X` narrows to one client.

## Configuration

Reuses the obsidian plugin's config at `~/.claude/obsidian.json` (`vault`,
`dashboard`). See
[obsidian.example.json](../obsidian/obsidian.example.json).

Dashboard layout assumed: today's day section sits unprefixed under
`## Focus`; every other day is inside a collapsed `> [!note]- Future` callout
with each line `"> "`-prefixed (the skills promote today out of the block and
write future days into it). Day headings as `## <Weekday> <d> <Month>` or
`### …`, client groups as `#### **<Client>**` inside each day, tasks as
`- [ ]` / `- [x]` checkboxes.

## Live Calendar Reading (ICS)

`scripts/ics-today.ts` fetches every feed in `~/.claude/calendars.json` on
each run: live query, never cached, so it is always fresh. It handles the
two things naive ICS grepping gets wrong: recurring events (DAILY/WEEKLY
rules expanded; anything else surfaced as an explicit warning) and
multi-day events (a trip that started yesterday still shapes today).
Calendars marked `"kind": "travel"` render in a Travel section that leads
the day view. Copy [calendars.example.json](calendars.example.json) to
`~/.claude/calendars.json` and add your feed URLs (they are secrets; the
config never enters a repo).
