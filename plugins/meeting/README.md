# Meeting

Notes from meetings you cannot or will not record in the meeting tool. Two
cases come up often. You join another organisation's Teams or Google Meet and
recording is turned off for guests. Or the meeting tool could record, but its
recording would then sit on a server you do not control.

[Meetily](https://github.com/Zackriya-Solutions/meetily) (MIT licence) records
and transcribes on your Mac. It hears your microphone and everything played
through your speakers, so it works with any meeting tool and needs no bot in
the call. This plugin takes Meetily's transcript into your Obsidian vault and
writes the note from it with `/meeting:notes`.

## Tell People

A local transcript is still a record of what people said. When the organiser
turned recording off, that was their decision. Say at the start of the meeting
that you take notes with local transcription. Client contracts can also cover
meeting records, whatever tool makes them.

## Setup

1. Install Meetily: `brew install --cask meetily`.
2. Open it once and allow **Microphone** and **System Audio Recording** in
   System Settings › Privacy & Security.
3. In Meetily's settings, pick the transcription model. Whisper large-v3-turbo
   handles Swedish and other languages. Parakeet is faster and good for
   English. Leave Meetily's own summary off: this plugin writes the summary.
4. Install the plugin: `/plugin install meeting@ai-toolkit`. It reads the
   vault and client map from the obsidian plugin's `~/.claude/obsidian.json`.

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

For those clients a hosted session exports the transcript into the vault and
stops without reading it. Run `/meeting:notes` again from `claude-local`
([practices/local-models](../../practices/local-models/README.md)) to write the
note.

The export script ([scripts/export.ts](scripts/export.ts)) prints only metadata
to the session. It reads a copy of Meetily's database and never changes
Meetily's own files.

## Where Notes Go

```text
Clients/<Client>/Meetings/<YYYY-MM-DD> <Title>.md
Clients/<Client>/Meetings/Transcripts/<YYYY-MM-DD> <Title> — transcript.md
```

If the note already exists, for example meeting prep written earlier, the
skill adds a `## Notes from the call` section at the end and leaves the rest
alone.

## Known Gaps

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
