# Meeting

Notes from meetings you cannot or will not record in the meeting tool. Two
cases come up often. You join another organisation's Teams or Google Meet and
recording is turned off for guests. Or the meeting tool could record, but its
recording would then sit on a server you do not control.

Samurai Scribe and [Meetily](https://github.com/Zackriya-Solutions/meetily)
(MIT licence) both record and transcribe on your Mac. They hear your
microphone and everything played through your speakers, so they work with any
meeting tool and need no bot in the call. This plugin writes the note from
either one into your Obsidian vault with `/meeting:notes`. It uses Samurai
Scribe when its MCP server is installed, and Meetily otherwise. The practice
behind it, and the approaches not taken, are in
[practices/meetings](../../practices/meetings/README.md).

Samurai Scribe labels speakers in the transcript and gives the session the
meeting's calendar event, through an MCP server. Meetily 0.4.1 does neither, so
its notes name people only where the transcript does.

## Tell People

A local transcript is still a record of what people said. When the organiser
turned recording off, that was their decision. Say at the start of the meeting
that you take notes with local transcription. Client contracts can also cover
meeting records, whatever tool makes them.

## Setup

Install the plugin: `/plugin install meeting@ai-toolkit`. It reads the vault
and client map from the obsidian plugin's `~/.claude/obsidian.json`. Then set
up one of the two recorders.

### Samurai Scribe

1. Install and open the Samurai Scribe app. Grant the permissions macOS asks
   for.
2. Add its MCP server for all projects:

   ```bash
   claude mcp add --scope user samurai-scribe -- "/Applications/Samurai Scribe.app/Contents/MacOS/Samurai Scribe Helper" --mcp
   ```

3. Start a new session. The Samurai Scribe tools load when a session starts.

### Meetily

1. Install Meetily: `brew install --cask meetily`.
2. Open it once and allow **Microphone** and **System Audio Recording** in
   System Settings › Privacy & Security.
3. In Meetily's settings, pick the transcription model. Whisper large-v3-turbo
   handles Swedish and other languages. Parakeet is faster and good for
   English. Leave Meetily's own summary off: this plugin writes the summary.

## Audio

Meetily captures system audio with a Core Audio tap on the macOS default output
device (macOS 14.2 or later). No virtual audio driver such as BlackHole is
needed, and headphones work as they are, including AirPods.

- Connect the headphones and make them the macOS output **before** you start
  recording.
- Leave the meeting tool's speaker and microphone on "System default".
- Use headphones rather than laptop speakers. With speakers, the microphone
  picks up the other people as well, and their words appear twice.

## Who Reads the Transcript

By default the session that runs `/meeting:notes` reads the transcript and
writes the summary, which with the hosted model means the transcript text is
sent to Anthropic. For a client whose meeting content must stay on the
machine, list it under `meetings.local_only`:

```json
{
  "meetings": {
    "local_only": ["Globex"]
  }
}
```

For those clients a hosted session stops without reading the transcript. Run
`/meeting:notes` again from `claude-local`
([practices/local-models](../../practices/local-models/README.md)) to write the
note. `claude-local` needs the Samurai Scribe MCP server too, so check that
`claude mcp list` shows it from a `claude-local` session.

- **Samurai Scribe:** the hosted session calls only `list_meetings`, which
  returns titles, dates and speaker names. It does not call `get_meeting`,
  `read_transcript`, `read_document`, `search` or `speaker_stats`, because
  those return what was said or summarised. The skill instructs this. Nothing
  in Samurai Scribe's MCP server enforces it, so the hosted model could still
  call them.
- **Meetily:** the hosted session exports the transcript into the vault with
  [scripts/export.ts](scripts/export.ts), which prints only metadata to the
  session. It reads a copy of Meetily's database and never changes Meetily's
  own files.

## Where Notes Go

```text
Clients/<Client>/Meetings/<YYYY-MM-DD> <Title>.md
Clients/<Client>/Meetings/Transcripts/<YYYY-MM-DD> <Title> — transcript.md
```

Meetily notes go there. A Samurai Scribe note is `Meeting Note.md` in the
meeting's own folder in the Samurai Scribe vault, beside `Transcript.md`, and
links the transcript, audio, summary and notes with wikilinks.

If the note already exists, for example meeting prep written earlier, the
skill adds a `## Notes from the call` section at the end and leaves the rest
alone.

Every note follows [templates/meeting-note.md](templates/meeting-note.md). Its
**Shareable** part (attendees, summary, mood and momentum, decisions, actions)
is ready to paste into Teams or email. Its **Record** part is internal: the
same decisions and actions with transcript times and quotes, the evidence for
the mood, open questions and observations. For Meetily, the audio stays on the
Mac and the note links to it with a delete-by date.

## Known Gaps

### Samurai Scribe gaps

- Unnamed speakers appear as `Sys Speaker 2` and similar. The note keeps those
  labels until the transcript or the calendar event names the person. Naming
  them in Samurai Scribe (`rename_person` or `edit_transcript`) improves later
  notes.
- This plugin has not been run end to end on a Samurai Scribe recording. Only
  the MCP server's meeting list and tool names have been checked.
- Where Samurai Scribe keeps audio, and whether deleting a meeting removes
  every copy, has not been checked.

### Meetily gaps

- Meetily 0.4.1's database has a `speaker` column (`mic` or `system`), but the
  code paths that save transcript segments do not fill it. A test recording
  confirmed it: microphone and system audio were both transcribed, into one
  unlabelled stream. The export adds **Me** and **Them** labels once Meetily
  fills the column.
- Segments are long (a one-minute test produced two), so the time stamped on a
  decision or action points to its segment rather than the exact sentence.
- Meetily saves each meeting's audio, plus a second copy of the transcript
  (`transcripts.json`), in `~/Movies/meetily-recordings/<meeting>/`. Deleting
  the meeting in the app removes it from the database but leaves that folder.
  Turn off audio saving in Meetily's Recordings settings if you only want
  text, and delete the folder by hand when you delete a meeting.
- The database layout is Meetily's internal format, not a published interface.
  A Meetily upgrade can change it. The tests in
  [scripts/export.test.ts](scripts/export.test.ts) pin the layout the script
  expects.
