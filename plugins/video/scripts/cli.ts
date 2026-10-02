#!/usr/bin/env bun
/**
 * storybook-video: record a narrated, subtitled tutorial video from a script.
 *
 * Usage:
 *   bun cli.ts <script.yaml> [--dry-run] [--no-voice] [--out <file>]
 *                            [--format mp4|webm] [--cache-dir <dir>]
 *                            [--headed] [--keep-temp]
 *
 * --dry-run    Validate the script and print the timing plan. Records nothing
 *              and calls no API. Voice lengths come from the cache, or are
 *              estimated (marked ~) for lines not generated yet.
 * --no-voice   Record without narration. No API key is needed.
 * --out        Write the video here instead of the script's `output`.
 * --format     mp4 (H.264 and AAC) or webm (VP9 and Opus). Without it, an
 *              output ending in .webm is WebM and anything else is MP4.
 * --cache-dir  Voice clip cache. Default $XDG_CACHE_HOME/storybook-video/voice,
 *              or ~/.cache/storybook-video/voice.
 * --headed     Show the browser while recording.
 * --keep-temp  Keep the raw recordings and intermediate files.
 *
 * Writes the video, and .srt, .vtt and .md beside it.
 *
 * Exit codes: 0 done; 1 recording, voice or ffmpeg failed; 2 bad arguments
 * or an invalid script.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  buildTimeline,
  chaptersFile,
  concatArgs,
  concatList,
  type Format,
  muxArgs,
  outputTarget,
  pickWebmCodecs,
  segmentArgs,
  type WebmCodecs,
} from "./assemble.ts";
import { defaultCacheDir, DiskClipCache } from "./clip-cache.system.ts";
import { MissingKeyError, resolveApiKey } from "./credentials.ts";
import { ElevenLabsClient, opRead } from "./elevenlabs.system.ts";
import {
  FfmpegProbe,
  findFfmpeg,
  listEncoders,
  runFfmpeg,
} from "./ffmpeg.system.ts";
import { introHtml, logoDataUri, logoMime } from "./intro.ts";
import { recordScenes } from "./record.system.ts";
import { loadScript, ScriptError } from "./script.ts";
import { serveFolder, type StaticServer } from "./serve.system.ts";
import { toSrt, toVtt } from "./subtitles.ts";
import { clock, formatPlan, planTiming } from "./timing.ts";
import { toTranscript } from "./transcript.ts";
import { isServerUrl } from "./urls.ts";
import { Voice } from "./voice.ts";

const log = (line: string): void => console.error(line);

/**
 * The intro logo as an <img> source. An http(s) URL is used as is; a file is
 * read and inlined as a data: URI. Exits with code 2 when the file is
 * missing or is not an image type the card supports.
 */
function resolveLogo(scriptDir: string, logo: string): string {
  if (isServerUrl(logo)) return logo;
  const path = resolve(scriptDir, logo);
  if (!existsSync(path)) fail(2, `intro.logo not found: ${path}`);
  const mime = logoMime(extname(path));
  if (!mime) fail(2, `intro.logo must be SVG, PNG, JPEG, WebP or GIF: ${path}`);
  return logoDataUri(readFileSync(path), mime);
}

function fail(code: number, message: string): never {
  console.error(message);
  process.exit(code);
}

async function main(argv: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      args: argv,
      options: {
        "cache-dir": { type: "string" },
        "dry-run": { type: "boolean" },
        format: { type: "string" },
        headed: { type: "boolean" },
        help: { short: "h", type: "boolean" },
        "keep-temp": { type: "boolean" },
        "no-voice": { type: "boolean" },
        out: { type: "string" },
      },
    });
  } catch (error) {
    fail(2, error instanceof Error ? error.message : String(error));
  }
  const { positionals, values } = parsed;
  if (values.help || positionals.length !== 1) {
    fail(
      values.help ? 0 : 2,
      "Usage: bun cli.ts <script.yaml> [--dry-run] [--no-voice] [--out <file>] [--format mp4|webm] [--cache-dir <dir>] [--headed] [--keep-temp]",
    );
  }
  const formatFlag = values.format;
  if (formatFlag !== undefined && formatFlag !== "mp4" && formatFlag !== "webm")
    fail(2, `--format must be mp4 or webm, not ${formatFlag}`);

  const scriptPath = resolve(positionals[0] as string);
  if (!existsSync(scriptPath)) fail(2, `Script not found: ${scriptPath}`);
  let script;
  try {
    script = loadScript(scriptPath, (path) => readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof ScriptError)
      fail(2, `${scriptPath}\n${error.message}`);
    throw error;
  }
  const scriptDir = dirname(scriptPath);
  const useVoice = Boolean(script.voice) && !values["no-voice"];
  const cache = new DiskClipCache(
    resolve(values["cache-dir"] ?? defaultCacheDir()),
  );

  const logoSrc = script.intro
    ? resolveLogo(scriptDir, script.intro.logo)
    : undefined;

  if (values["dry-run"]) {
    const lengths = useVoice
      ? Voice.lengthsFromCache(script, cache)
      : new Map();
    console.log(`${script.title}\n`);
    console.log(formatPlan(planTiming(script, lengths)));
    if (useVoice) {
      const missing = [...lengths.values()].filter((l) => l.estimated).length;
      console.log(
        missing
          ? `\n${missing} line(s) have no voice clip yet; their length is estimated (~). A real run generates them.`
          : "\nEvery voice clip is cached. A real run makes no API calls.",
      );
    } else if (script.voice)
      console.log("\n--no-voice: lengths come from reading time and pauses.");
    return;
  }

  const target = outputTarget(
    resolve(values.out ?? join(scriptDir, script.output)),
    formatFlag as Format | undefined,
  );
  const output = target.path;
  const stem = join(dirname(output), basename(output, extname(output)));
  mkdirSync(dirname(output), { recursive: true });

  const ffmpeg = await findFfmpeg();
  const probe = new FfmpegProbe(ffmpeg);
  let webm: undefined | WebmCodecs;
  if (target.format === "webm") {
    webm = pickWebmCodecs(await listEncoders(ffmpeg));
    if (useVoice && !webm.audio) {
      fail(
        1,
        "This ffmpeg has no Opus or Vorbis encoder, so it cannot put voice in a WebM. Use --no-voice or an MP4.",
      );
    }
    log(`WebM: ${webm.video} video${useVoice ? `, ${webm.audio} audio` : ""}`);
  }

  let clips = new Map<string, { durationMs: number; path: string }>();
  if (useVoice) {
    try {
      const prepared = await Voice.prepare(script, {
        cache,
        client: async () =>
          new ElevenLabsClient(await resolveApiKey(process.env, opRead)),
        probe,
      });
      clips = prepared.clips;
      log(
        `Voice: ${prepared.generated} clip(s) generated, ${prepared.reused} reused from the cache.`,
      );
    } catch (error) {
      if (error instanceof MissingKeyError) fail(2, error.message);
      throw error;
    }
  } else if (!script.voice)
    log("The script has no `voice` block, so the video has no narration.");
  else log("--no-voice: recording without narration.");

  const plan = planTiming(script, Voice.lengthsFromClips(clips));
  log(`Planned length: ${clock(plan.totalMs)}`);

  let server: StaticServer | undefined;
  let baseUrl: string | undefined;
  if (script.storybook) {
    if (isServerUrl(script.storybook)) baseUrl = script.storybook;
    else {
      const folder = resolve(scriptDir, script.storybook);
      if (!existsSync(folder)) fail(2, `storybook folder not found: ${folder}`);
      if (
        script.scenes.some((s) => s.story) &&
        !existsSync(join(folder, "iframe.html"))
      ) {
        fail(
          2,
          `${folder} has no iframe.html. Build Storybook first (storybook build).`,
        );
      }
      server = await serveFolder(folder);
      baseUrl = server.url;
    }
  }

  const workDir = mkdtempSync(join(tmpdir(), "storybook-video-"));
  try {
    const recorded = await recordScenes({
      baseUrl,
      headed: Boolean(values.headed),
      introHtml:
        script.intro && logoSrc
          ? introHtml({
              background: script.intro.background,
              durationMs: plan.introMs,
              logoSrc,
              subtitle: script.intro.subtitle,
              title: script.title,
            })
          : undefined,
      log,
      plan,
      probe,
      script,
      workDir,
    });
    const timeline = buildTimeline(recorded);
    const maxLine = script.subtitles.max_line;
    writeFileSync(`${stem}.srt`, toSrt(timeline.cues, maxLine));
    writeFileSync(`${stem}.vtt`, toVtt(timeline.cues, maxLine));
    const sceneStarts = timeline.sceneStarts.slice(script.intro ? 1 : 0);
    writeFileSync(`${stem}.md`, toTranscript(script, sceneStarts));
    const chapters = join(workDir, "chapters.txt");
    writeFileSync(chapters, chaptersFile(timeline.chapters));

    log("Encoding scenes");
    const segments: string[] = [];
    for (const [i, scene] of recorded.entries()) {
      const out = join(workDir, `segment-${i + 1}.mp4`);
      await runFfmpeg(
        ffmpeg,
        segmentArgs({
          durationMs: scene.durationMs,
          offsetMs: scene.offsetMs,
          out,
          size: script.viewport,
          source: scene.videoPath,
        }),
      );
      segments.push(out);
    }
    const list = join(workDir, "segments.txt");
    writeFileSync(list, concatList(segments));
    const joined = join(workDir, "video.mp4");
    await runFfmpeg(ffmpeg, concatArgs(list, joined));

    const placed = [...clips.entries()].flatMap(([key, clip]) => {
      const startMs = timeline.stepStarts.get(key);
      return startMs === undefined ? [] : [{ path: clip.path, startMs }];
    });
    log(
      target.format === "webm"
        ? `Encoding the WebM${placed.length ? " and mixing voice" : ""}`
        : "Mixing voice and subtitles",
    );
    await runFfmpeg(
      ffmpeg,
      muxArgs({
        chapters,
        clips: placed,
        format: target.format,
        out: output,
        // A WebM never carries subtitles; a player loads the .vtt beside it.
        srt:
          script.subtitles.burn || target.format === "webm"
            ? undefined
            : `${stem}.srt`,
        totalMs: timeline.totalMs,
        video: joined,
        webm,
      }),
    );
    const finalMs = await probe.durationMs(output);
    console.log(
      [
        `Video:      ${output}  (${clock(finalMs)})`,
        `Subtitles:  ${stem}.srt, ${stem}.vtt`,
        `Transcript: ${stem}.md`,
      ].join("\n"),
    );
  } finally {
    await server?.close();
    if (values["keep-temp"]) log(`Kept intermediate files in ${workDir}`);
    else rmSync(workDir, { force: true, recursive: true });
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  fail(1, error instanceof Error ? error.message : String(error));
});
