---
name: plan
description: Create or update the master-plan note for the current repo in the Obsidian vault. Reads open/merged PRs, the tracker (Jira or GitHub, per client config), and repo plan detail pages; writes state to the vault, never to the repo. Use when the user says "/planner:plan", "update the master plan", or "refresh the plan".
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Planner: Plan

Maintain the master-plan note for the current repo in the Obsidian vault.
The vault is the only home for planning — both _state_ (backlog tables, status
balls, roadmap, in the master note) and _detail_ (scope, acceptance criteria,
Test Plan, in the subpages). Repos hold code and shipped documentation, never
plans. Successor to the per-repo `master-plan:discovery` + `master-plan:refine`
skills.

## Principles

- **Minimum chatter.** Every mechanical step is a premade command. Announce
  nothing but the result.
- **One note per run.** A run touches exactly one vault note — the resolved
  client's note for this repo. Never another client's folder.
- **Operator prose is sacred.** Sections marked operator-owned (`## In Short`
  and any section without a `<!-- planner:managed -->` marker) are never
  rewritten — byte-for-byte preserved.
- **Idempotent.** A second run on unchanged inputs produces a zero diff.
- **The master note is a live worklist.** Open work only. A finished
  initiative's row is **deleted**, never archived — the subpage is the
  durable record. There is no Done section. Master notes are excluded from
  RAG indexing (same rule as Dashboard.md: an index is always stale for
  state); subpages are indexed.
- **Status lives once, in subpage frontmatter.** The master note's balls are
  a human display derived from it; prose never carries status.

## Step 1 — Resolve context (silent)

```bash
CTX=$(bun "<skill-base-dir>/../../scripts/resolve-context.ts")
# {"client":…,"vault":…,"plans":…,"plansDir":…,"tracker":"jira|github|none",…}
```

`--client X` from the arguments overrides cwd resolution. Abort on non-zero
exit, surfacing the script's one-line error verbatim.

The target note is `<plansDir>/<repo-name> — Master Plan.md`, where
`repo-name` is `basename $(git rev-parse --show-toplevel)`. Create the
directory and note from the template below if absent.

## Step 2 — Gather inputs (parallel, silent)

1. **PRs**: `gh pr list --state all --limit 100 --json number,title,state,headRefName,mergedAt,url`
2. **Tracker**, by `tracker` value:
   - `jira` — fetch open issues for the configured project via the repo's
     Jira CLI skill (e.g. `jira-acli`) if present; if the CLI is unavailable,
     proceed with PRs only and note the gap in the run summary.
   - `github` — `gh issue list --state open --json number,title,labels,url`
   - `none` — skip; the vault subpages and PRs are the only source.
3. **Subpages**: existing subpages under `<plansDir>/<repo-name>/`, frontmatter
   only (`key`, `kind`, `status`, `summary`).
4. **Legacy repo plans**: if the repo still carries `docs/plans/**/*.md` from
   before the vault migration, read titles + status lines as input and flag
   them in the run summary for migration. Never write there.

## Step 3 — Update the note

Managed sections (each fenced by `<!-- planner:managed -->` …
`<!-- /planner:managed -->`):

- **Active backlog** — one row per open initiative:
  `| Status | Key | Initiative | Type | Owner | Detail |`. Key is the Jira
  key, `#issue`, or a slug depending on tracker. Detail links to the repo
  page or PR by URL.
- **Legend** — the four-ball vocabulary, exactly:
  🟢 done/merged · 🟡 in progress · ⚪ planned/parked · 🔴 blocked/bug.

Rules:

- New initiatives found in PRs/tracker but absent from the note are appended
  to Active backlog as ⚪, and a stub subpage with frontmatter is created at
  `<plansDir>/<repo-name>/<kind>/<key>-<slug>.md`. `/planner:goal` later fills
  that subpage in with the acceptance criteria and Test Plan.
- Rows whose PR merged or ticket closed are **deleted** from the note after
  the subpage's frontmatter is set to `status: done` (that is `/planner:sync`'s
  job — plan never deletes silently, it flags).
- Anything in the note but no longer found anywhere is flagged in the run
  summary, not removed.
- Never edit outside the managed fences.
- **Detail links to the note itself**, `| Detail |` column: the subpage first,
  the PR only when there is no subpage.

## Step 3b — Repair the dashboard entries

`/planner:goal` writes an entry in the right shape when it plans a goal. This
step is the sweep for everything planned before that, or edited since. Three
repairs, in order: the `[Details]` link, then the ticket link's position, then
the order of the entries themselves.

### 3b.1 — Missing `[Details]` links

For every checkbox in `<vault>/Dashboard.md` that belongs to this repo's
client:

1. **Match it to a subpage.** By ticket key in the entry text against subpage
   `key` frontmatter, then by slug or title. No match, no action.
2. **Already ends with a `[Details](…)` link** — verify the target file exists.
   Correct a broken path; otherwise leave the entry untouched.
3. **No `[Details]` link** — append one at the very end of the entry, path
   vault-relative from `Dashboard.md`, spaces percent-encoded. A wikilink to the
   same page already in the prose is **not** a substitute: leave it where it is
   and still append the `[Details]` link, so every entry ends the same way.
4. **Ticket key but no subpage** — flag it in the run summary. Never invent a
   subpage from a dashboard entry; a stub only comes from a PR or tracker item
   (the rule above).

Ticked (`- [x]`) entries are swept too — a finished item still needs to reach
its record.

### 3b.2 — Ticket link to the front

The ticket link belongs immediately after the checkbox, before any bold text or
status emoji, so the key is the first thing read. Move it there when it sits
later in the entry:

```markdown
- [ ] **[KEY-1](url) converter conformance suite** _(note)_. …
- [ ] [KEY-1](url) **converter conformance suite** _(note)_. …
```

- **Move the link, keep the words.** Bold, emphasis and emoji stay on the text
  they were applied to; only the link moves out in front of them. Repair the
  markers the move breaks — an orphaned `**` left where the link used to sit is
  a defect, not prose.
- **Only when the entry is about that one ticket.** A roundup naming several
  keys mid-sentence ("still open from that run: KEY-1, KEY-2, KEY-3") is left
  alone — promoting one key would misrepresent it. Two keys planned as one unit
  are the exception: lead with both, in order.
- **No ticket, no change.** Never synthesise a link to make an entry conform.

### 3b.3 — Finished entries to the bottom of their section

Open (`- [ ]`) entries come first, ticked (`- [x]`) entries move to the bottom —
of **their own section**, never of the client block as a whole. Open work is
what the day is for; finished work is the record underneath it.

- **A section is one contiguous run of checkboxes**, and it ends at any
  non-checkbox line — a heading, a bold paragraph, a callout, a blank line
  followed by prose. A client block often holds several. Never move an entry
  between them: the paragraph above a run is what gives it its meaning, so a
  ticked item dropped into the next run reads as belonging to a story it was
  never part of.
- **Relative order is preserved** within the open group and within the ticked
  group. This is a stable partition, not a re-ranking.
- **Idempotent.** A run already partitioned is not rewritten.

The prose is the operator's and is preserved byte-for-byte through all three
repairs. Only link position, marker repair, and line order change.

## Subpage frontmatter (required on every plan subpage)

```yaml
---
type: plan
client: Acme # any value from the `clients` map
repo: acme-platform
key: PROJ-861 # ticket key, NNN-slug, or bare slug
kind: bug # epic | story | task | bug | spike | refinement | global
status: in-progress # planned | in-progress | done | blocked | parked
phase: "6" # optional
owner: Tobias # optional
created: 2026-08-07
updated: 2026-08-10
completed: 2026-08-12 # required once status: done; omit the key otherwise
summary: One-line abstract of the initiative.
jira: https://… # or github: … ; optional
---
```

`client` must match the value `resolve-context.ts` returns for that folder —
the full configured name, not a shortened form, or a filter on `client`
silently misses that client's notes.

`status` takes only the five enum values. `closed`, `open`, `active` and
`complete` are not among them; map them onto `done` / `in-progress` rather than
widening the enum, so a query for finished work has one answer to look for.

`completed` is **required** on a subpage whose status is `done`, and absent on
every other. It is the only date that says when the work finished — `updated`
moves whenever the page is touched afterwards.

### No `## Status` section

Status is frontmatter and nothing else. A new subpage never gets a `## Status`
heading, and `/planner:goal` does not write one.

Existing pages that carry one are **not** stripped wholesale: many hold
narrative that exists nowhere else. Flag them in the run summary. A section is
safe to remove only when it restates the frontmatter and adds nothing — as a
rule of thumb, under ~120 characters — and any link inside it moves to
`## References` first.

Text enums, not emoji, so status is filterable metadata and embeds cleanly.
`client`/`repo` are explicit so scoping survives file moves. `summary` is a
stable one-line abstract for retrieval. Dates are absolute. Status appears
nowhere else — not in the subpage prose, not duplicated in headings.

## Step 4 — Report

One short summary: note path, rows added/moved/flagged, tracker gaps. No
tables, no restating the note.

## Note template

```markdown
# <repo-name> — Master Plan

> [!note] Operator intent — planner never edits this section.

## In Short

(operator-owned)

## Active backlog

<!-- planner:managed -->

| Status | Key | Initiative | Type | Owner | Detail |
| ------ | --- | ---------- | ---- | ----- | ------ |

<!-- /planner:managed -->

## Legend

🟢 done/merged · 🟡 in progress · ⚪ planned/parked · 🔴 blocked/bug
```
