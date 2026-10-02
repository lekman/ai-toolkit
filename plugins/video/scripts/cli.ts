#!/usr/bin/env bun
/**
 * storybook-video: record a narrated, subtitled tutorial video from a script.
 *
 * Usage:
 *   bun cli.ts <script.yaml> [--dry-run] [--no-voice] [--out <file.mp4>]
 *                            [--cache-dir <dir>] [--headed] [--keep-temp]
 *
 * --dry-run    Validate the script and print the timing plan. Records nothing
 *              and calls no API. Voice lengths come from the cache, or are
 *              estimated (marked ~) for lines not generated yet.
 * --no-voice   Record without narration. No API key is needed.
 * --out        Write the MP4 here instead of the script's `output`.
 * --cache-dir  Voice clip cache. Default $XDG_CACHE_HOME/storybook-video/voice,
 *              or ~/.cache/storybook-video/voice.
 * --headed     Show the browser while recording.
 * --keep-temp  Keep the raw recordings and intermediate files.
 *
 * Writes <output>.mp4, and .srt, .vtt and .md beside it.
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
  concatArgs,
  concatList,
  muxArgs,
  segmentArgs,
} from "./assemble.ts";
import { defaultCacheDir, DiskClipCache } from "./clip-cache.system.ts";
import { MissingKeyError, resolveApiKey } from "./credentials.ts";
import { ElevenLabsClient, opRead } from "./elevenlabs.system.ts";
import { FfmpegProbe, findFfmpeg, runFfmpeg } from "./ffmpeg.system.ts";
import { recordScenes } from "./record.system.ts";
import { parseScript, ScriptError } from "./script.ts";
import { serveFolder, type StaticServer } from "./serve.system.ts";
import { toSrt, toVtt } from "./subtitles.ts";
import { clock, formatPlan, planTiming } from "./timing.ts";
import { toTranscript } from "./transcript.ts";
import { isServerUrl } from "./urls.ts";
import { Voice } from "./voice.ts";

const log = (line: string): void => console.error(line);

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
      "Usage: bun cli.ts <script.yaml> [--dry-run] [--no-voice] [--out <file.mp4>] [--cache-dir <dir>] [--headed] [--keep-temp]",
    );
  }

  const scriptPath = resolve(positionals[0] as string);
  if (!existsSync(scriptPath)) fail(2, `Script not found: ${scriptPath}`);
  let script;
  try {
    script = parseScript(readFileSync(scriptPath, "utf8"));
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

  let output = resolve(values.out ?? join(scriptDir, script.output));
  if (extname(output).toLowerCase() !== ".mp4") output += ".mp4";
  const stem = join(dirname(output), basename(output, ".mp4"));
  mkdirSync(dirname(output), { recursive: true });

  const ffmpeg = await findFfmpeg();
  const probe = new FfmpegProbe(ffmpeg);

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
    writeFileSync(`${stem}.md`, toTranscript(script));

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
    log("Mixing voice and subtitles");
    await runFfmpeg(
      ffmpeg,
      muxArgs({
        clips: placed,
        out: output,
        srt: script.subtitles.burn ? undefined : `${stem}.srt`,
        totalMs: timeline.totalMs,
        video: joined,
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
