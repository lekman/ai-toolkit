---
name: goal
description: Plan a goal before any execution. Derive the acceptance criteria and Definition of Done, write them as a Test Plan section in the initiative's vault subpage, and refine them with the operator until approved. Hands off to /planner:execute for autonomous execution. Use for "plan this goal", "set the acceptance criteria", "what's the definition of done".
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Goal Plan (the Plan Phase)

Turn a goal into a written, agreed Definition of Done **before** any execution.
This is the interactive half of the workflow: the operator owns the acceptance
criteria and the evidence that counts as proof; this skill captures and
sharpens them with the operator, then hands off to
[`/planner:execute`](../execute/SKILL.md).

This skill **does not write source code or run tests**. It produces and refines
a plan. Execution is `/planner:execute`'s job.

## Why Plan First

The division of labour between operator and agent only works when the contract
is written down before the agent starts. Two agents can then hold each other to
it: one executes toward the plan, another (for example a QA reviewer account)
verifies the plan was met. Without a written plan, "done" is whatever the
executing agent last believed, and there is nothing to steer back to.

## Where the Plan Lives

In the vault, never in the repo. Resolve the location with the same script
`/planner:plan` uses:

```bash
CTX=$(bun "<skill-base-dir>/../../scripts/resolve-context.ts")
# {"client":…,"vault":…,"plansDir":…,"tracker":"jira|github|monday|none",…}
```

- **Master note**: `<plansDir>/<repo-name> — Master Plan.md`. One per repo,
  owned by `/planner:plan`. This skill never edits it.
- **Subpage**: `<plansDir>/<repo-name>/<kind>/<key>-<slug>.md`, where `kind`
  is `epics` / `stories` / `tasks` / `bugs` / `spikes` / `refinement` /
  `global`. This is the goal's plan document, and the only file this skill
  writes.

Every subpage carries the planner frontmatter (`type: plan`, `client`, `repo`,
`key`, `kind`, `status`, dates, `summary`) specified in `/planner:plan`:
status lives there and nowhere else.

## What It Produces

A `## Test Plan` section in the initiative's subpage, holding:

- **Acceptance Criteria**: what "done" means, in the operator's words.
- **Test Plan table**: one row per evidence base in scope:

```markdown
## Test Plan

| What to test | How (evidence base) | Surface   | Status      | Evidence                   |
| ------------ | ------------------- | --------- | ----------- | -------------------------- |
| <claim>      | Linting             | <package> | not-started | linter clean               |
| <claim>      | E2E (negative)      | deployed  | not-started | no-auth call rejected, log |
| <claim>      | E2E (positive)      | deployed  | not-started | authed call succeeds, log  |
```

Every security or correctness claim needs **both** a negative and a positive
row. Status starts `not-started`. The Evidence column names the **artefact that
proves it** (a test report, a captured response, a coverage file), not a proxy
like "the container ran".

## Steps

1. **Identify the goal and the ticket.** From the argument, the branch name, or
   ask the operator. The ticket lives in whatever system the `tracker` field
   names: Jira, GitHub Issues, or Monday; the subpage references it via the
   `key` and `jira`/`github`/`monday` frontmatter fields. For `monday`, resolve
   the item by name on the configured board with the Monday MCP connector and
   record its numeric item id as `key`. If the connector is not authorised,
   ask the operator for the item id rather than inventing one.
2. **Derive the candidate Definition of Done.** List the surfaces the work
   touches (libraries, services, infrastructure, the deployed system, the user
   journey) and the evidence base each needs. A deployed-service change needs
   static checks + unit + integration + end-to-end against the deployment; a
   user-facing flow also needs intended-use verification.
3. **Write the AC + Test Plan** into the subpage. Create it if absent, with the
   planner frontmatter and sections: Scope, Acceptance Criteria, Test Plan,
   Captured Evidence, Blockers, Follow-ups, References. No Status section:
   status is frontmatter only.
4. **Show it and refine, interactively.** Open the plan so the operator reads
   it in their editor, then iterate: adjust the acceptance criteria, tighten
   the evidence definition, add or remove rows. Loop with the operator until
   they agree. This is the only place the operator and the plan converge; take
   the time here.
5. **Get the explicit OK.** Loop until the operator approves the Test Plan.
6. **Link it from the dashboard** (see below).
7. **Hand off.** Tell the operator to run `/planner:execute` to execute
   autonomously. **Do not start executing here.**

## Step 6: Link the Plan from the Dashboard

Every planned goal must be reachable from the root dashboard
(`<vault>/Dashboard.md`, path from `~/.claude/obsidian.json#dashboard`), so the
day's worklist points at the contract.

**The dashboard keeps non-today days inside a collapsed `> [!note]- Future`
callout**, so an entry there reads `> - [ ] …` — match checkboxes with an
optional `"> "` prefix, and when updating such an entry in place, preserve its
prefix byte-for-byte. New entries are appended under today's heading, which is
the unprefixed section outside the block.

**Find the existing entry first.** Search the whole dashboard, not only today,
for an open checkbox mentioning the ticket key (`PROJ-881`, `#123`, the
Monday item id) or, if there is no ticket, the initiative's slug or title.

- **Found**: update that entry in place. Do not move it, do not restate it, do
  not duplicate it under today.
- **Not found**: append a new entry under today's heading in `## Focus`, in the
  active client's group, following `/obsidian:add`'s conventions (day heading
  `date "+%A %-d %B"`, created if absent; refuse on an iCloud conflict copy).

**Entry shape**, in both cases:

<!-- markdownlint-disable MD013 -->

```markdown
- [ ] [KEY-1](https://host/browse/KEY-1) **Title.** …prose… [Details](Clients/X/Initiatives/repo/tasks/key-1-slug.md)
```

<!-- markdownlint-enable MD013 -->

One line, whatever its length: the checkbox, the ticket link, the operator's
prose, the `[Details]` link.

- **Ticket link first**, immediately after the checkbox, before any bold text or
  status emoji. One link, to the tracker: Jira `https://<jira_host>/browse/<KEY>`,
  GitHub `https://github.com/<org>/<repo>/issues/<n>`, Monday
  `https://<monday.account>.monday.com/boards/<monday.board>/pulses/<KEY>`. No
  ticket resolvable: skip the link and start with the title; never invent a key.
- **`[Details](<path>)` last**, at the very end of the entry. The path is
  vault-relative from `Dashboard.md` (which sits at the vault root), pointing at
  the subpage `.md` file. Percent-encode spaces (`%20`).
- **Prose in the middle is the operator's.** Leave it byte-for-byte on an
  update; only add the two links if they are missing, and correct the `[Details]`
  target if the subpage moved.
- **Idempotent.** A second run on an unchanged plan produces a zero diff. An
  entry that already has both links is left alone.

## The Operator's Role

State the acceptance criteria and what evidence proves execution, not the
steps. This skill captures and sharpens those. `/planner:execute` then reaches
them independently.

## Boundary

- This skill stops at an **approved Test Plan**, linked from the dashboard. It
  writes only in the vault (the subpage and the dashboard entry): never source,
  never tests.
- `/planner:execute` reads the Test Plan this skill produced and drives it to
  validated (through pre-commit, CI, CD, and deployed verification).
