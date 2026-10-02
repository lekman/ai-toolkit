# Video

Record a tutorial video of a real interface from a short YAML script. The
[storybook skill](skills/storybook/SKILL.md) (`/video:storybook`) opens
Storybook stories, or any page, in Chromium, and walks through the steps the
script lists. A drawn cursor moves to each target, a ring highlights it, and a
caption bar shows the line being spoken.

## What You Get

- An MP4 (H.264 video, AAC audio), with one chapter per scene.
- An optional intro card with a logo and the title.
- SubRip (`.srt`) and WebVTT (`.vtt`) subtitles, always.
- A markdown transcript that also works as a written guide.

## How It Works

1. **Validate.** The script is checked against a schema. Every problem is
   reported with its path, such as `scenes[1].steps[0].target`.
2. **Voice.** Each spoken line goes to the ElevenLabs text-to-speech API
   once. The clip is cached on disk under a hash of the text and every voice
   setting, so a re-run pays only for lines that changed.
3. **Plan.** Each step lasts the longest of its voice clip, the time needed to
   read its caption, and its `pause`.
4. **Record.** Playwright records each scene in its own browser context. The
   recorder notes the real start time of every step and caption.
5. **Assemble.** An intro card, when the script has one, is recorded first,
   and every later time moves by its length. ffmpeg cuts each recording to
   the part after the page was ready, joins the scenes, places each voice
   clip at the recorded start of its step, and writes the MP4 with one
   chapter per scene. The subtitles come from the same recorded times.

## What It Costs

- **ElevenLabs characters.** Every new or changed line is billed. The cache
  makes re-runs free when nothing changed.
- **Disk.** About 45 MB for the ffmpeg binary, plus Playwright's Chromium if
  it is not installed yet.
- **A third party sees the script.** The spoken text goes to ElevenLabs. Never
  put patient data, personal data or secrets in a script.
- **ffmpeg licence.** `ffmpeg-static` downloads a GPL build of ffmpeg at
  install time. The repository does not include it.

## Install

```text
/plugin marketplace add lekman/ai-toolkit
/plugin install video@ai-toolkit
```

Then run `bun install` in the plugin folder once, as the
[skill](skills/storybook/SKILL.md) describes.

## Development

```bash
cd plugins/video
bun test             # unit tests, plus the end-to-end render when Chromium is installed
bun run typecheck
```

The end-to-end tests record small local pages from `tests/fixtures/` with
Chromium and ffmpeg, and point the voice client at a local stand-in API.
`tests/elevenlabs.live.test.ts` makes one real API call and runs only when
`ELEVENLABS_API_KEY` or `ELEVENLABS_API_KEY_REF` is set.

Files that touch the outside world end in `.system.ts`. The rest is pure and
tested without mocks.
