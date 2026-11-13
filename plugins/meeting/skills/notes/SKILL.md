---
name: notes
description: Turn a meeting recorded and transcribed locally by Samurai Scribe or Meetily into a meeting note in the active client's Obsidian vault folder, with summary, decisions, actions and open questions. Respects a per-client rule that the transcript may only be read by a local model. Use when the user says "/meeting:notes", "write up the meeting", "notes from the call", or "summarise the meeting I just had".
user-invocable: true
allowed-tools: Read, Write, Bash, mcp__samurai-scribe__list_meetings, mcp__samurai-scribe__get_meeting, mcp__samurai-scribe__read_transcript
---

<!-- This skill follows the Agent Skills open standard: https://agentskills.io -->

# Meeting Notes

Samurai Scribe or Meetily records and transcribes the meeting on this Mac. This
skill writes the note from one meeting into the client's vault folder.

- **Samurai Scribe** keeps the transcript in its own vault and gives it to this
  session through its MCP server. Nothing is exported.
- **Meetily** keeps the transcript in a database. The export script writes it to
  a file and prints only metadata.

In both cases, whether this session may **read** the transcript depends on the
client (Step 2). Listing meetings never puts what was said into the session.

## Step 1: Resolve the Client, the Source and the Meeting

Resolve the client the same way the obsidian plugin does: an argument naming a
client wins, then the working directory against `clients` in
`~/.claude/obsidian.json`, then `default_client`. If none of those resolves,
ask with AskUserQuestion, listing the client names from the config.

Pick the source. An argument naming `samurai` or `meetily` wins. Otherwise use
Samurai Scribe when the `mcp__samurai-scribe__list_meetings` tool is available,
and Meetily when it is not.

List recent meetings.

- **Samurai Scribe:** call `list_meetings` with `limit` 5. The result has each
  meeting's date, title, speakers and id.
- **Meetily:**

  ```bash
  bun "${CLAUDE_PLUGIN_ROOT}/scripts/export.ts" --list --limit 5
  ```

Use the newest meeting unless the user named another, or the newest has zero
segments (Meetily) or no speakers (Samurai Scribe), or it started more than 12
hours ago. In those cases show the list and ask which meeting with
AskUserQuestion.

If Samurai Scribe's tools fail to connect, ask the user to open the Samurai
Scribe app and try again. An error that
Meetily's database is not found means Meetily has not recorded anything on this
machine yet. Say so and stop.

## Step 2: Decide Who May Read the Transcript

Read `meetings.local_only` from `~/.claude/obsidian.json` (a list of client
names, absent means empty).

- **Client not in the list**: this session reads the transcript and writes the
  note.
- **Client in the list, session on a local model** (`ANTHROPIC_BASE_URL`
  points at `localhost` or `127.0.0.1`): this session reads the transcript and
  writes the note.
- **Client in the list, session on the hosted model**: **stop without reading
  it**. For Meetily, export the transcript first (Step 3). For Samurai Scribe,
  call no tool except `list_meetings`, because `get_meeting`,
  `read_transcript`, `read_document`, `search` and `speaker_stats` return what
  was said or summarised. Tell the user to run `/meeting:notes` again from a
  `claude-local` session, which continues from Step 3 (Meetily) or Step 4
  (Samurai Scribe).

```bash
jq -r '.meetings.local_only // [] | .[]' ~/.claude/obsidian.json
echo "${ANTHROPIC_BASE_URL:-hosted}"
```

## Step 3: Export the Transcript (Meetily Only)

Skip this step for Samurai Scribe.

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

Read the transcript.

- **Samurai Scribe:** call `get_meeting` for the linked calendar event
  (organiser, attendees) and the speakers, then `read_transcript`. Lines read
  `[time] Speaker: text`. A long transcript is cut with a note giving the
  `from_seconds` to continue from, so call it again until the end. Speakers
  that Samurai Scribe has named are used as named. Generic labels such as
  `Mic Speaker` (the user's microphone) and `Sys Speaker 2` (someone heard
  through the speakers) stay generic. Use a person's name for a generic label
  only when the transcript or the calendar event makes it clear.
- **Meetily:** read the exported file. Lines are labelled **Me** (the user's
  microphone) and **Them** (everyone heard through the speakers) when Meetily
  recorded the source, and unlabelled otherwise. Meetily 0.4.1 leaves them
  unlabelled.

Segments can run 30 seconds or more, so a time points to the segment, not the
exact sentence. Name people only when the transcript names
them. Do not guess who said a line from its content.

Write the note from
[`templates/meeting-note.md`](../../templates/meeting-note.md),
replacing every `{placeholder}`.

- **Samurai Scribe:** write `Meeting Note.md` in the meeting's own folder,
  beside `Transcript.md` (the folder is `Meetings/<YYYY-MM-DD> <Title>` in the
  Samurai Scribe vault, which `get_meeting` reports). Keep the keys
  `samurai_id` (the meeting's id), `samurai_kind: document` and `meeting`
  (a wikilink to the meeting note), because the app uses them to tie the note
  to the meeting. Take the client from the argument, then from the attendee
  email domains against the clients in `~/.claude/obsidian.json`, and ask when
  neither names one.
- **Meetily:** write `$VAULT/Clients/<Client>/Meetings/<YYYY-MM-DD> <Title>.md`.

If that file exists (for example, prep notes written before the meeting), add
the template's sections under a `## Notes from the call` heading at the end and
change nothing above it.

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
- **Links:** for Samurai Scribe, link the meeting folder's `Transcript`,
  `_playback.m4a`, `Summary` and `Notes` with wikilinks, only for files that
  exist. For Meetily, link the exported transcript file, and link the Meetily
  audio file with a `file://` URL and set `audio_delete_by` (default: one week
  after the meeting). Do not copy audio into the vault. When the file is
  deleted, replace the link with "Audio deleted on {date}".
- Write each paragraph and each list item on one line. Obsidian shows a line
  break inside a paragraph as a visible break, so wrapped lines read as stray
  breaks.
- Follow the house tone (`tone:write`).

## Step 5: Report

Reply with the note's path, the counts of decisions, actions and open
questions, and every action where the owner is the user. Do not add the
actions to the dashboard unless the user asks.
