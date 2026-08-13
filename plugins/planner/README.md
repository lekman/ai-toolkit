# planner

Planning over an Obsidian vault, at three time scales: the day (`/today`), the
repo (`/planner:plan`, `/planner:sync`), and one goal (`/planner:goal`,
`/planner:execute`). Where the [obsidian plugin](../obsidian/README.md) owns
the mechanics of the dashboard (add, tick, wrap up), planner owns what goes on
it and what "done" means.

All planning state lives in the vault, never in a repo: a master note per repo
(`<Initiatives>/<repo> — Master Plan.md`) for _where the work stands_, and a
subpage per initiative (`<Initiatives>/<repo>/<kind>/<key>-<slug>.md`) for the
scope, acceptance criteria and Test Plan. The dashboard links to the subpage;
the repo holds code and shipped documentation only.

## Why a separate skill

Sessions asked "what's my plan" tend to reach for calendars or a knowledge
index first — and both give confidently wrong answers, because task state
lives only in the tracker. Calendars know meetings, not tasks; a retrieval
index is always stale for state (which is why `Dashboard.md` is deliberately
excluded from indexing). The skill hard-codes the source order: dashboard
first, retrieval and calendars as supplements only.

## Commands

- `/planner:plan` — create or update the current repo's master-plan note in
  the Obsidian vault. State (backlog tables, status balls) lives only in the
  vault; repos keep detail pages. Client and tracker (Jira / GitHub / Monday /
  none) resolve silently from cwd via `scripts/resolve-context.ts` and the
  `planner` block in `~/.claude/obsidian.json`. Monday needs
  `monday: {account, board}` — `account` is the subdomain, and without it no
  item URL can be built.
- `/planner:sync` — reconcile that note against merged PRs and closed
  tickets: move finished rows to Done, report drift, change nothing else.
- `/planner:goal` + `/planner:execute` — the goal workflow (moved here from
  the retired goal plugin): agree a Definition of Done as a `## Test Plan` in
  the initiative's subpage, link it from the dashboard (ticket link first,
  `[Details](path)` last), then execute it autonomously to a validated result.
- `/planner:archive` — move completed items off the dashboard into
  `Archive/Work Logs/<year>/<Month>.md`, across **all** clients. A client
  group with nothing left open moves entirely; a day with no groups left
  loses its heading. Deliberately silent: it prints `Done` or
  `No items found to archive` and nothing else, because the point is to
  reduce what there is to read.
- `/today` — the day's open items across **all** clients, grouped per
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

Dashboard conventions assumed: day headings as `## <Weekday> <d> <Month>` or
`### …`, client groups as `#### **<Client>**` inside each day, tasks as
`- [ ]` / `- [x]` checkboxes.

## Live calendar reading (ICS)

`scripts/ics-today.ts` fetches every feed in `~/.claude/calendars.json` on
each run — live query, never cached, so it is always fresh. It handles the
two things naive ICS grepping gets wrong: recurring events (DAILY/WEEKLY
rules expanded; anything else surfaced as an explicit warning) and
multi-day events — a trip that started yesterday still shapes today.
Calendars marked `"kind": "travel"` render in a Travel section that leads
the day view. Copy [calendars.example.json](calendars.example.json) to
`~/.claude/calendars.json` and add your feed URLs (they are secrets — the
config never enters a repo).
