---
name: notes
description: Turn a meeting recorded and transcribed locally by Meetily into a meeting note in the active client's Obsidian vault folder, with summary, decisions, actions and open questions, plus the full transcript beside it. Respects a per-client rule that the transcript may only be read by a local model. Use when the user says "/meeting:notes", "write up the meeting", "notes from the call", or "summarise the meeting I just had".
user-invocable: true
allowed-tools: Read, Write, Bash
---

<!-- This skill follows the Agent Skills open standard: https://agentskills.io -->

# Meeting Notes

Meetily records and transcribes the meeting on this Mac. This skill exports one
meeting from Meetily's database into the vault and writes the note from it.

The export script writes the transcript to a file and prints only metadata, so
exporting never puts what was said into this session. Whether this session may
then **read** the transcript depends on the client (Step 2).

## Step 1: Resolve the Client and the Meeting

Resolve the client the same way the obsidian plugin does: an argument naming a
client wins, then the working directory against `clients` in
`~/.claude/obsidian.json`, then `default_client`. If none of those resolves,
ask with AskUserQuestion, listing the client names from the config.

List recent meetings:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/export.ts" --list --limit 5
```

Use the newest meeting unless the user named another, or the newest has zero
segments, or it started more than 12 hours ago. In those cases show the list
and ask which meeting with AskUserQuestion.

An error that the database is not found means Meetily has not recorded
anything on this machine yet. Say so and stop.

## Step 2: Decide Who May Read the Transcript

Read `meetings.local_only` from `~/.claude/obsidian.json` (a list of client
names, absent means empty).

- **Client not in the list**: this session reads the transcript and writes the
  note.
- **Client in the list, session on a local model** (`ANTHROPIC_BASE_URL`
  points at `localhost` or `127.0.0.1`): this session reads the transcript and
  writes the note.
- **Client in the list, session on the hosted model**: export the transcript
  (Step 3), then **stop without reading it**. Tell the user to run
  `/meeting:notes` again from a `claude-local` session, which finds the
  transcript already in place and continues from Step 4.

```bash
jq -r '.meetings.local_only // [] | .[]' ~/.claude/obsidian.json
echo "${ANTHROPIC_BASE_URL:-hosted}"
```

## Step 3: Export the Transcript

```bash
VAULT=$(jq -r .vault ~/.claude/obsidian.json)
DIR="$VAULT/Clients/<Client>/Meetings/Transcripts"
bun "${CLAUDE_PLUGIN_ROOT}/scripts/export.ts" \
  --meeting <id> --out "$DIR/<YYYY-MM-DD> <Title> — transcript.md"
```

Take the date from the meeting's `createdAt`, converted to local time (Meetily stores UTC). Remove `/ \ : * ? " < > |` from
the title. The script refuses to overwrite. If the file already exists, use it
as it is and do not export again.

## Step 4: Write the Note

Read the transcript. Lines are labelled **Me** (the user's microphone) and
**Them** (everyone heard through the speakers) when Meetily recorded the
source, and unlabelled otherwise. Meetily 0.4.1 leaves them unlabelled.
Segments can run 30 seconds or more, so a time points to the segment, not the
exact sentence. Name people only when the transcript names
them. Do not guess who said a line from its content.

Write `$VAULT/Clients/<Client>/Meetings/<YYYY-MM-DD> <Title>.md` from
[`templates/meeting-note.md`](../../templates/meeting-note.md),
replacing every `{placeholder}`. If that file
exists (for example, prep notes written before the meeting), add the template's
sections under a `## Notes from the call` heading at the end and change nothing
above it.

The note has two parts:

- **Shareable** is what the user pastes into Teams or email for the people in
  the meeting and their team: attendees by company, a summary by topic, Mood
  and Momentum, decisions and actions. It holds no patient or personal data,
  no internal observations, and no speaker the transcript does not make clear.
- **Record** is internal: every decision and action with the transcript time
  and a short quote, the quotes behind the mood, Reading the Room, open
  questions, and observations.

Rules for the content:

- **Attendees** are name and company only, without titles or credentials. Take
  them from the transcript, the meeting invite or the user, never from a guess.
- **Mood and Momentum** says how the meeting felt, where the work stands, what
  worries the other side raised, and whether a follow-up is needed. The
  transcript has words, not tone, so every line needs a quote under Mood
  Evidence. Put worries the other side raised in the Shareable part, worded
  neutrally. Put your own concerns, and anything that would be awkward to
  share, under Reading the Room.
- Every decision, action and open question in the Record carries the
  transcript time it came from, so the user can check it.
- An action with no clear owner gets `Owner not named` as its owner. Do not
  assign it to the user by default.
- Leave out a Record section that has nothing in it. In the Shareable part,
  write "None" instead, so a reader sees it was checked.
- Write nothing the transcript does not support. Transcription mishears names,
  product terms and numbers. Mark anything that looks misheard with `(?)`
  instead of correcting it silently.
- **Audio link:** link the Meetily audio file with a `file://` URL and set
  `audio_delete_by` (default: one week after the meeting). Do not copy the
  audio into the vault. When the file is deleted, replace the link with
  "Audio deleted on {date}".
- Write each paragraph and each list item on one line. Obsidian shows a line
  break inside a paragraph as a visible break, so wrapped lines read as stray
  breaks.
- Follow the house tone (`tone:write`).

## Step 5: Report

Reply with the note's path, the counts of decisions, actions and open
questions, and every action where the owner is the user. Do not add the
actions to the dashboard unless the user asks.
