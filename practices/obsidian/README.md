# Obsidian as an Agent-Operated Workspace

How to run an Obsidian vault where an AI agent (Claude Code) does most of the
writing, filing and tidying. Written so a colleague can copy the practice
rather than guess at it. The reader is a consultant or engineer who keeps
notes for more than one client and wants an agent to maintain them.

The short claim: Obsidian holds the notes, and the agent works inside them.
The value is not the plugins. It is that the vault has written conventions, so
the agent produces the same shape of note every time.

## The Stack at a Glance

| Layer               | What it is                                   | What it does                                                             |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Obsidian            | Local markdown editor over a folder of `.md` | The notes themselves; nothing is locked in a proprietary format          |
| Community plugins   | A small, earned set                          | Issue-tracker previews, Dataview queries, image conversion, a terminal   |
| ObsidiBot           | Obsidian plugin by Scott Kirvan              | Chat panel that runs Claude Code as a subprocess with the vault as `cwd` |
| Claude Code         | Anthropic's agent CLI                        | The actual agent; reads `CLAUDE.md`, rules and skills                    |
| Rules and skills    | Markdown files in `.claude/`                 | The house style and the repeatable jobs                                  |
| Plugin marketplaces | GitHub repositories                          | Shared skills across machines and clients (this repo is one)             |

## Obsidian Setup

Vault settings worth copying, all from `.obsidian/app.json`:

- **New notes land in `_Drafts/`.** Nothing is filed at creation time. Filing
  happens later, by hand or by the agent, once the note has a subject.
- **Attachments go to `_Attachments/`** and unlinked attachments are deleted
  automatically.
- **Links update on move** (`alwaysUpdateLinks`), which is what makes bulk
  renaming safe.
- **The vault opens on `Dashboard.md`** every time, so the first thing on
  screen is the day's plan.
- **`_Attachments`, `CLAUDE.md` and `Archive` are hidden from search** and the
  quick switcher. They stay on disk and the agent still reads them; they just
  stop polluting results.
- **Inline title is off**, because the H1 in the body is the title.

Plugins that have earned a place here: an issue-tracker card renderer (keys
written with a fixed prefix so the plugin picks them up), Dataview for the
client landing pages, Advanced URI for deep links from outside the vault, an
image converter that turns pasted screenshots into `.webp`, copy-as-html for
pasting into email or Teams, a markdown-to-tracker-markup converter, Mermaid
helpers with a CSS snippet that widens diagrams, a terminal, and BRAT to
install and auto-update ObsidiBot from GitHub. Add plugins only when a real
need appears; several more were tried here and switched off.

## Vault Conventions

The conventions are the part that matters, because they are what the agent is
instructed to follow.

**Folders.** One folder per client under `Clients/`, each with `Meetings/`,
`Initiatives/`, `Reports/`, `_Attachments/` and a landing page named after the
client. Business admin sits under `Management/`, private material under
`Personal/`, finished engagements under `Archive/`.

**Frontmatter is required on every note.** The schema lives in a rule file the
agent always loads:

```yaml
---
type: meeting | note | document | reference | template
client: ClientA | ClientB | YourCompany | Personal | Templates
status: draft | active | archived
stage: planned | post-meeting | complete # meetings only
tags: []
created: YYYY-MM-DD
---
```

`created` is set once and never touched again. `status` starts at `draft` and
moves to `active` when the note is in real use.

**Naming.** Descriptive, never a bare date. Meeting notes are
`YYYY-MM-DD Topic.md`. Reports carry the date in the title, for example
`Weekly status call, meeting notes, 14 August 2026`.

**Links.** `[[wikilinks]]` internally, standard markdown for external links.
Issue keys carry the tracker prefix so the preview plugin renders them.

**Writing style.** One rule file holds the house style (plain language, banned
filler words); the agent applies it to everything it generates, including
commit messages.

## The Dashboard Method

`Dashboard.md` is the centre of the working day. It is plain markdown, hand
and agent maintained, with no Dataview queries in it. The maintenance rules
are written into a collapsed callout at the top of the file itself, so they
travel with the artefact.

The shape:

- **Focus is a day-by-day log**, earliest at the top. Today's section sits
  expanded directly under the heading; every future day lives inside a
  collapsed `Future` callout, so exactly one day is open on screen.
- **Under each day, work is grouped per client, never mixed.** Separate
  contracts stay separate.
- **Each client block opens with a plain-language overview callout** of what
  that client's work achieved, ending with `Watch:` for blockers. Written so a
  non-engineer can follow it, because the overviews feed stand-ups and client
  calls directly.
- **Future days carry an `Intention:` callout per client** stating the goal.
  At end of day, the overview answers it: did the promise hold?
- **Finished days are archived** into `Archive/Work Logs/<year>/<Month>.md`,
  newest first there, keeping the overview callouts. Closed months get a short
  per-client review at the top.

The reason for the overview callouts is that they are reused. Nothing is
written twice: the day's note becomes the stand-up, the week's notes become
the client meeting, the month's notes become the review.

## ObsidiBot

ObsidiBot puts a chat panel in the Obsidian sidebar. Behind it, Claude Code
runs as a subprocess with the vault root as its working directory. It is the
same agent used in a terminal, given the vault instead of a code repository.
Documentation: [ObsidiBot](https://www.scottkirvan.com/ObsidiBot/).

What makes it different from pasting into a chat window:

- It reads and writes vault files directly, so "file this draft under the
  client and add the frontmatter" is one sentence rather than a copy-paste
  loop.
- The active note is passed in automatically, and so are files open in a split
  pane. There is rarely any need to say which note is meant.
- It can drive the Obsidian interface: open a file, open it beside the current
  one, jump to a heading, run a command from the palette.
- It picks up `CLAUDE.md`, the rules and the skills, so house style is applied
  without being restated.

Two settings deserve comment:

- **Permission mode.** Full access is set here deliberately, because the
  workflow depends on shell tools (`pandoc`, `python3`, `gh`). It also means
  the agent can delete files, and the only safety net in an iCloud vault is
  version history. Start in an ask-first mode and move up once you can predict
  what the agent will do.
- **The context file.** A single markdown file describing the vault, the
  conventions and the active clients, injected at the start of every session.
  The agent updates it when it learns something durable. This is the highest
  value part of the setup and the least obvious; without it, every session
  starts by rediscovering the same facts.

### Skills, Where Most of the Gain Sits

A skill is a folder under `.claude/skills/<name>/` with a `SKILL.md` inside: a
name, a description of when to use it, and prose instructions. It then works
as `/name` in the chat panel. The vault-local skills here, generalised:

| Skill shape         | What it does                                                                            |
| ------------------- | --------------------------------------------------------------------------------------- |
| Report builder      | Produces a formal `.docx` deliverable following the client's document conventions       |
| Weekly meeting note | Builds the recurring client meeting note from the Dashboard overviews and the last note |
| Stand-up note       | Builds the daily stand-up, tracking which promises from yesterday actually held         |
| Graph connector     | Adds a `## Related` section across notes so graph view is connected, not decorative     |
| Landing page        | Creates or refreshes a client overview page                                             |
| Batch rename        | Proposes shorter filenames across a folder, then renames and fixes every wikilink       |
| Evidence scan       | Runs an authorised scan against a client's own endpoints and writes an evidence report  |

The pattern to take away: whenever a piece of writing has been done the same
way three times, it becomes a skill. The instructions are prose, not code.

## The Claude Code Layer Underneath

Worth knowing about, because it explains behaviour that otherwise looks like
magic.

**Instruction files chain.** `~/.claude/CLAUDE.md` points at this repository's
[standards](../../standards/), which split the house rules into small files:
how to work together, tone, bias, evidence, judgment and proportion. The
vault's own `CLAUDE.md` adds the vault-specific part on top.

**Rules directory.** `.claude/rules/` in the vault holds the always-on files:
the frontmatter schema, response style, the word blocklist, the bias
checklist, the Dashboard rules and the archiving rules.

**Shared skills come from GitHub marketplaces.** This repository supplies the
`planner`, `wrap`, `obsidian`, `git`, `tone` and `dependabot` plugins; a
client can supply its own marketplace for client-specific skills. They
auto-update, so the same commands work on every machine.

**Client detection is path-based.** A config file maps repository paths to
clients, so a session started in a client's repository knows which client it
serves, where plans belong in the vault, and which tracker (Jira, Monday,
GitHub) the client uses. The same file holds the Dashboard path and
per-client regulatory flags.

The practical result is that a planning command run in a code repository
writes to the vault, and the end-of-day wrap in the vault reconciles against
GitHub pull requests. Notes and code stay joined without either being copied
into the other.

## A Day in the Vault

1. **Open Obsidian.** It lands on the Dashboard, today expanded, the rest
   collapsed.
2. **Promote the day.** The previous day's final archive run does this
   automatically; the fallback is to cut today's section out of the `Future`
   callout, strip one quote level, and place it above the block.
3. **Work.** Rough notes go into `_Drafts/`. Meeting notes are dictated or
   typed roughly and processed afterwards.
4. **Tick as things finish**, not at the end. The overview callout is written
   the same way, in plain language.
5. **Ask the agent for the repeatable pieces**: the weekly meeting note before
   the call, the stand-up note before stand-up, the report builder when
   something goes to a client as Word.
6. **End of day.** The wrap skill reconciles the Dashboard against real state,
   rolls open items forward and archives the finished day. A handover skill
   writes a cold-start note when work passes to someone else or to another
   agent session.

## Setting It up Yourself

1. Install Obsidian and open a folder as a vault.
2. Set new notes to a `_Drafts` folder, attachments to `_Attachments`, and
   turn on automatic link updating.
3. Install BRAT from the community plugin browser, then add
   `ScottKirvan/ObsidiBot` through it.
4. Install Claude Code and sign in. ObsidiBot drives the CLI, so it must work
   in a terminal first.
5. Start in ask-first permission mode. Move to full access only once you can
   predict what the agent will do.
6. Write `CLAUDE.md` at the vault root: structure, frontmatter schema, style
   rules. Two pages is plenty.
7. Let ObsidiBot create its context file, then read it and correct it.
8. Add plugins only when a real need appears.
9. Write your first skill after the third time you produce the same document
   by hand.

## Before You Copy It

- **Put the vault under git if you can.** This one is not; version history
  comes from iCloud Drive alone. A colleague setting up fresh should consider
  a git repository, with private client material in mind.
- **iCloud Drive plus an agent writing files can conflict.** The Dashboard in
  particular is edited live, and two agents (or two machines) editing it race
  with last-writer-wins and no conflict copy. Verify after writing; prefer
  several small edits over one large one.
- **Secrets do not belong in the vault.** Plugin tokens live in plugin
  configuration; nothing of that kind goes into a note, since the whole vault
  is readable by the agent and syncs to iCloud.
- **Client separation is a contractual matter, not a tidiness preference.**
  Never write a combined note across two clients. One folder per client, one
  group per client on the Dashboard, and an agent instructed to keep them
  apart.
- **Do not treat generated text as verified.** A claim written down is
  load-bearing, because the next reader trusts it instead of checking.
  Reports and client deliverables get read before they are sent.
