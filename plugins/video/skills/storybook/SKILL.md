---
name: storybook
description: Record a narrated, subtitled tutorial video (MP4) from Storybook stories or any web page, driven by a YAML script. Draws a cursor, a highlight ring and a caption bar over the real UI, speaks each line with an ElevenLabs voice, and writes SRT and WebVTT subtitles and a markdown transcript. Use when the user says "/video:storybook", "make a tutorial video", "record a walkthrough from Storybook", or "turn this script into a video".
user-invocable: true
---

# Storybook Video

Turn a short YAML script into a tutorial video of the real UI. Each scene
opens one Storybook story (or a URL). Each step says a line and, if asked,
does something on the page: click, type, hover, highlight, scroll, wait or
press a key. The tool records the screen, adds the voice, and writes
subtitles and a transcript from the same timeline.

It records the real interface. It does not generate footage, so what the
viewer sees is what the component does.

## When to Use

- A how-to video for an end user, built from components that already have
  stories.
- A walkthrough that must stay in step with the UI. Re-run the script after a
  UI change and the video follows.
- A written guide as well as a video. The transcript is a numbered list of
  the spoken lines under one heading per scene.

Do not use it for marketing footage, for anything that needs a real login or
real data, or for pages that hold patient data (see
[Never Put Patient Data in a Script](#never-put-patient-data-in-a-script)).

## What It Writes

From `output: out/tour.mp4` in the script:

| File           | Contents                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------- |
| `out/tour.mp4` | H.264 video and AAC audio, with one chapter per scene. Silent audio when there is no voice. |
| `out/tour.srt` | SubRip subtitles.                                                                           |
| `out/tour.vtt` | WebVTT subtitles, for a web player.                                                         |
| `out/tour.md`  | The transcript: scene headings with their start times, and the spoken lines.                |

Subtitles are always written. With `subtitles.burn: true` (the default) the
captions are drawn into the picture by the caption bar. With `burn: false`
the caption bar is hidden and the MP4 carries a soft subtitle track instead.
The MP4 never has both, so captions never show twice.

## Before the First Run

The CLI is `bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli.ts`. In a clone of the
ai-toolkit repository it is `plugins/video/scripts/cli.ts`.

1. Install the dependencies once. This also downloads an ffmpeg binary
   through the `ffmpeg-static` package.

   ```bash
   bun install --cwd "${CLAUDE_PLUGIN_ROOT}"
   ```

2. Make sure Playwright has a Chromium build for its pinned version (1.63.0).
   Playwright honours `PLAYWRIGHT_BROWSERS_PATH`. When its own build is
   missing, the tool tries installed Google Chrome before it gives up.

   ```bash
   cd "${CLAUDE_PLUGIN_ROOT}" && bunx playwright install chromium
   ```

3. Have a Storybook to point at: a running one (`http://localhost:6006`) or a
   static build folder (`storybook build` writes `storybook-static/`). The tool
   serves a folder itself on `127.0.0.1`. It does not start or build
   Storybook.

ffmpeg is found in this order: `FFMPEG_PATH`, the `ffmpeg-static` binary,
then `ffmpeg` on `PATH` (for example from `brew install ffmpeg`).

## Write a Script

Keep the script in the project the video is about, for example
`docs/videos/approve-a-case.yaml`. Paths in it are relative to the script.

```yaml
title: Approving a Case
output: out/approve-a-case.mp4 # .srt, .vtt and .md are written beside it
viewport: { width: 1920, height: 1080 } # the default
storybook: ../../packages/ui/storybook-static # or http://localhost:6006
voice:
  provider: elevenlabs
  voice_id: DODLEQrClDo8wCz460ld # Lauren, US English
  model_id: eleven_multilingual_v2 # the default
  stability: 0.5
  similarity_boost: 0.75
subtitles:
  burn: true # draw captions into the picture (default)
intro: # optional title card before the first scene
  logo: brand/logo.svg # file relative to the script, or an https URL
  duration: 3 # seconds (default 3)
  subtitle: For clinical reviewers
  background: "#ffffff" # the default
scenes:
  - title: The Case List
    story: pages-cases--sample-data
    steps:
      - say: The case list shows every case waiting for review.
        do: highlight
        target: role=heading[name="Cases"]
      - say: Choose a period here. Let's look at this week.
        do: click
        target: role=button[name="This week"]
  - title: Find a Case
    story: components-search--empty
    steps:
      - say: Type the case number to find it.
        do: type
        target: role=textbox[name="Case number"]
        value: "1234"
      - say: Press Enter to search.
        do: press
        value: Enter
        pause: 2.5
```

### Top-Level Keys

| Key         | Required                               | Meaning                                                                           |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `title`     | yes                                    | Heading of the transcript, and the title on the intro card.                       |
| `output`    | yes                                    | Path of the MP4, relative to the script.                                          |
| `scenes`    | yes                                    | One or more scenes, recorded in order.                                            |
| `storybook` | for `story` scenes and relative `url`s | URL of a running Storybook, or a built Storybook folder.                          |
| `viewport`  | no                                     | `width` and `height` in pixels. Default 1920 by 1080.                             |
| `voice`     | no                                     | ElevenLabs settings. Without it the video has no narration.                       |
| `subtitles` | no                                     | `burn` (default `true`) and `max_line`, characters per caption line (default 42). |
| `intro`     | no                                     | A title card before the first scene. Without it the video starts with scene 1.    |

Voice settings other than `voice_id` are optional: `model_id`,
`output_format` (default `mp3_44100_128`), `stability`, `similarity_boost`,
`style`, `speed` and `use_speaker_boost`. They go to ElevenLabs as they are.

### Intro Card

With an `intro` block, the video opens on a card with the logo, the script's
`title` under it, and the `subtitle` if there is one. The card fades in, holds,
and fades out over `duration` seconds (1 to 15, default 3). It has no voice and
no caption bar.

- `logo`: an SVG, PNG, JPEG, WebP or GIF file, relative to the script, or an
  `https://` URL. A file is embedded in the card, so the page needs no file
  access. Use a logo made for the card's background.
- `background`: a hex colour, a colour name, or `rgb()`/`hsl()`. The text is
  dark on a light background and white on a dark one.

The card is an HTML page recorded like a scene, so fonts and SVG render as
in a browser. Everything after it moves later by its length: the subtitles,
the voice, the chapters and the transcript times.

### Scenes

Each scene has `steps` and exactly one of `story` or `url`.

- `story`: a Storybook story id, such as `pages-dashboard--sample-data`. The scene
  opens `iframe.html?id=<story>&viewMode=story`, which shows the story alone
  without the Storybook sidebar. List the ids with
  `jq -r '.entries | keys[]' storybook-static/index.json`, or from
  `http://localhost:6006/index.json`.
- `url`: any page. A relative URL resolves under `storybook`.

`title` names the scene in the transcript. `wait_for` is a target that must be
visible before the first step, for a story that loads data after it renders.

### Steps

| Key      | Meaning                                                                            |
| -------- | ---------------------------------------------------------------------------------- |
| `say`    | The line spoken and shown as a caption.                                            |
| `do`     | `click`, `type`, `hover`, `highlight`, `scroll`, `wait` or `press`.                |
| `target` | The element to act on. Needed by `click`, `type`, `hover` and `highlight`.         |
| `value`  | The text for `type`, the key for `press` (`Enter`, `Tab`), or pixels for `scroll`. |
| `pause`  | Seconds the step lasts at least.                                                   |

A step needs `say`, `do`, or both. Unknown keys are errors, so a typo such as
`tagret` is reported, not ignored.

A target is a Playwright selector. Prefer what the user sees:

- `role=button[name="Save"]`: by accessible role and name. Survives styling
  changes.
- `text=Open findings`: by visible text.
- `[data-testid=case-row]`, `#q`, `.card`: CSS, when nothing visible fits.

The first match is used. The cursor moves to the centre of the target before
the action, and `highlight` draws a ring around it for the rest of the step.

## Run It

Always validate first. A dry run prints the timing plan and makes no API
calls:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/cli.ts" docs/videos/approve-a-case.yaml --dry-run
```

Then record without voice, which costs nothing and finds broken targets:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/cli.ts" docs/videos/approve-a-case.yaml --no-voice
```

Then record with voice:

```bash
ELEVENLABS_API_KEY_REF=op://Private/ElevenLabs/api_key \
  bun "${CLAUDE_PLUGIN_ROOT}/scripts/cli.ts" docs/videos/approve-a-case.yaml
```

| Flag                | Effect                                                          |
| ------------------- | --------------------------------------------------------------- |
| `--dry-run`         | Validate and print the timing plan. No recording, no API calls. |
| `--no-voice`        | Record without narration. No key needed.                        |
| `--out <file.mp4>`  | Write here instead of the script's `output`.                    |
| `--cache-dir <dir>` | Voice clip cache. Default `~/.cache/storybook-video/voice`.     |
| `--headed`          | Show the browser while recording.                               |
| `--keep-temp`       | Keep the raw recordings and intermediate files.                 |

Exit code 2 means the script or the arguments are wrong, or no key was found;
the message names the problem. Exit code 1 means recording, the voice API or
ffmpeg failed. A failed step names its scene, step and target.

After a run, check the result before reporting it done. Extract a frame or
two with ffmpeg at the times in the `.srt` and look at them.

## Voice Setup

The tool calls the ElevenLabs text-to-speech API once per spoken line and
keeps each clip in the cache. The cache key is a hash of the text, voice,
model, output format and every voice setting, so changing one line
regenerates only that line. A run where every clip is cached needs no key.

The tool uses the first of these that is set.

1. `ELEVENLABS_API_KEY`.
2. `ELEVENLABS_API_KEY_REF`, a 1Password reference such as
   `op://Private/ElevenLabs/api_key`, read with `op read`. The 1Password app
   may ask for approval the first time.

The key is never printed or logged. Without a key, a run that needs a new
clip stops before recording and says how to provide one; use `--no-voice` to
record anyway.

To choose a voice, list the account's voices in the ElevenLabs app and copy
the voice id. `eleven_multilingual_v2` is the default model.

## Never Put Patient Data in a Script

Every `say` line is sent to ElevenLabs, a third-party service. A script must
never contain protected health information (PHI), personal data, or secrets.
Write lines about what the screen does, not about whose record it is.

The video also shows whatever the page shows. Record stories that use
sample data only, never a page connected to real patient records, because
the MP4 is shared once it exists.

## How Timing Works

Each step lasts the longest of:

- its voice clip plus 0.4 seconds;
- the time to read its caption, at 15 characters per second, and at least
  1.5 seconds;
- its `pause`.

A step with no line and no pause lasts 0.8 seconds. The intro card, when
there is one, comes before all of this. Each scene shows for 0.8
seconds before its first step and 0.7 seconds after its last. The voice
starts as the step starts, while the cursor travels to the target.

A long line is split into caption chunks of at most two lines. Each chunk
gets a share of the step in proportion to its length.

The recorder notes the real start of every step and caption. If a page is
slow and a step overruns, the subtitles and voice follow what was recorded,
not the plan. Burned captions are part of the picture, so they always match
it. Soft subtitles and voice are placed from the recorded times and land
within about a tenth of a second.

## Limits

- Chromium only. Each scene starts in a fresh browser context, so state
  such as a ticked box does not carry into the next scene.
- A story's `play` function runs before the first step, so the story may
  already be in its played state.
- The tool does not start or build Storybook.
- Playwright records each scene at about 1 Mbit/s before the final encode.
  Small text on a busy page can soften slightly. Larger viewports or fewer
  moving parts help.
- Subtitle tracks are tagged as English.
- ElevenLabs bills by character. A dry run shows which lines are not cached
  yet (marked `~`).
