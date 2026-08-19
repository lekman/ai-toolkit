---
name: handover
description: Write an agent-ready handover note in the Obsidian vault so another agent — a session on another machine, a fresh run, a containerised or hosted agent — can pick the work up cold, and link it from today's dashboard. Use only when the user asks for it — "/wrap:handover", "hand this over", "write a handover", "another agent takes this from here". Never start it on your own initiative, including at the end of a session.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion
---

# Write a Handover

Pass work to an agent that was not in this conversation. The output is one vault
note written to the contract in [HANDOVER.md](../../HANDOVER.md): **read that
first**; it defines every section and the writing rules. This skill covers how
to gather the evidence, where the note goes, and how it gets found.

The note is the deliverable. Do not do the work being handed over.

## Step 1: Resolve Config and Active Client

Same pattern as the obsidian plugin (both read `~/.claude/obsidian.json`):

```bash
CONFIG=~/.claude/obsidian.json
VAULT=$(jq -r .vault "$CONFIG")
DASHBOARD="$VAULT/$(jq -r .dashboard "$CONFIG")"
CWD="$(pwd)"
ACTIVE=$(jq -r --arg cwd "$CWD" '
  [.clients | to_entries[] | select(.key as $k | $cwd | startswith($k))]
  | sort_by(.key | length) | reverse | .[0].value
' "$CONFIG")
[ -z "$ACTIVE" ] || [ "$ACTIVE" = "null" ] && ACTIVE=$(jq -r .default_client "$CONFIG")
```

Refuse on iCloud conflict copies (`ls "$VAULT"/Dashboard\ *.md`), same as the
obsidian skills.

## Step 2: Fix the Scope

Decide, and confirm with `AskUserQuestion` if the session covered more than one
thread:

- **Topic**: a short noun phrase for the filename (`outbound delivery`,
  `evidence refresh`). One topic per handover; two threads means two notes.
- **Who picks it up**: another machine's agent, a fresh run here, a
  containerised or hosted agent with no vault access, or future-you. This
  changes only Step 6, never the content.

Then check for an existing note for the same topic and day:
`ls "$VAULT/Clients/$ACTIVE/Handover — "*.md`. Update that note in place rather
than creating a second one for the same day.

## Step 3: Verify Before You Write

The handover's value is that its claims are true. Claims carried over from the
conversation are the ones that rot, so re-check them now rather than restating
them. In particular:

- **State that was inferred, not observed.** Anything concluded from an absence
  ("it is not deployed, so it does not exist") gets checked directly.
- **Deployed versus declared.** A merged PR, a registered revision, or a green
  pipeline is not a running system. Run the command that reads the live state.
- **Anything last checked on a previous day.**

Record, for each claim, whether you verified it and on what date. Where you
could not verify, write that instead of smoothing it over: an unverified claim
labelled as such is useful; one presented as fact is a trap.

Useful evidence sources: the repo working tree and branch, `gh pr list` /
`gh pr view` for the referenced PRs, the deployed-state commands the tasks
themselves will use, and the client's master-plan notes in the vault for durable
context.

## Step 4: Write the Note

Path for client work:

```text
$VAULT/Clients/<ACTIVE>/Handover — <topic>, <Day> <D> <Mon> <YYYY>.md
```

Non-client work (`default_client`, personal, admin): `$VAULT/Personal/Handover — …`.

Date format: `date "+%a %-d %b %Y"` (for example `Tue 11 Aug 2026`).

Follow [HANDOVER.md](../../HANDOVER.md) section by section: frontmatter, the
audience line, the goal, **hard constraints before any task**, access, ordered
tasks each with its verification command and expected result, done-already,
corrected-wrong-beliefs, open findings marked _do not fix unilaterally_, what is
blocked externally, and references.

Two rules that are easy to lose under time pressure:

- **Gate the irreversible.** A new running service, an external send, a
  production touch: mark it _needs an operator decision_, with the reason. Do
  not leave it as an ordinary task.
- **Never write credentials or secret values.** Profile names, role names, and
  account identifiers only.

## Step 5: Link It from the Dashboard

Today's section is the unprefixed one outside the collapsed `> [!note]- Future`
callout (future days live inside it, `"> "`-prefixed — do not write there).
Under `## Focus`, find today's heading (`date "+%A %-d %B"`) and the active
client's `#### <Client>` sub-heading. Insert directly **below** that client's
intention or overview callout, before the checkboxes:

```markdown
> [!abstract] **[[Handover — <topic>, <Day> <D> <Mon> <YYYY>]]** — <one line on
> what it covers and who takes it from here>
```

If today's heading or the client sub-heading does not exist, create the client
sub-heading under today's heading rather than writing the callout at day level.
Never mix clients.

Change nothing else on the dashboard. Do not tick items; that is
`/obsidian:wrapup` and `/wrap:day`.

## Step 6: Report

Three lines at most:

1. The note path, and the wiki-link now on the dashboard.
2. How the receiving agent finds it: with vault access, by searching for the
   topic (handover notes are indexed); otherwise give the full path.
3. Anything you could **not** verify in Step 3, so the operator knows what the
   next agent is trusting.

If the receiving agent has no vault access (a containerised, isolated, or
hosted run), offer to print the note's full text for pasting into that session.
Do not write a copy into the repository.

## Constraints

- The vault is the only home. Never write a handover into a repo, `.tmp/`, or
  anywhere outside the vault.
- Never assert an unverified claim as verified, and never drop a claim you could
  not check: label it.
- Read-only on the work itself: this skill writes a note, it does not apply,
  deploy, merge, or fix.
- Dashboard edits are limited to the one `> [!abstract]` callout under the
  active client's heading for today.
