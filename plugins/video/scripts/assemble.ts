/**
 * Turn recorded scenes into one timeline, and build the ffmpeg arguments that
 * cut, join and mux the final video. Pure: nothing here runs ffmpeg.
 */

import type { Cue } from "./subtitles.ts";

/** One scene as recorded, with times relative to the moment the scene was ready. */
export interface RecordedScene {
  /** Chapter title for the scene. */
  label: string;
  /** Captions shown during the scene, relative to the scene start. */
  captions: Cue[];
  /** Length of the usable part of the recording. */
  durationMs: number;
  /** Where the usable part starts inside the raw recording. */
  offsetMs: number;
  /** Actual start and end of each step, relative to the scene start. */
  steps: { endMs: number; key: string; startMs: number }[];
  videoPath: string;
}

/** A chapter of the video: one per recorded scene, the intro included. */
export interface Chapter {
  endMs: number;
  startMs: number;
  title: string;
}

/** The whole video on one clock. */
export interface Timeline {
  chapters: Chapter[];
  cues: Cue[];
  sceneStarts: number[];
  /** Global start of each step, keyed by `scene:step`. */
  stepStarts: Map<string, number>;
  totalMs: number;
}

/** Place every scene end to end and move captions and steps onto the global clock. */
export function buildTimeline(scenes: RecordedScene[]): Timeline {
  const chapters: Chapter[] = [];
  const cues: Cue[] = [];
  const sceneStarts: number[] = [];
  const stepStarts = new Map<string, number>();
  let t = 0;
  for (const scene of scenes) {
    sceneStarts.push(t);
    for (const c of scene.captions) {
      cues.push({ endMs: t + c.endMs, startMs: t + c.startMs, text: c.text });
    }
    for (const s of scene.steps) stepStarts.set(s.key, t + s.startMs);
    chapters.push({
      endMs: t + scene.durationMs,
      startMs: t,
      title: scene.label,
    });
    t += scene.durationMs;
  }
  return { chapters, cues, sceneStarts, stepStarts, totalMs: t };
}

/** Chapter markers in ffmpeg's metadata file format. */
export function chaptersFile(chapters: Chapter[]): string {
  const escape = (v: string): string =>
    v.replace(/[=;#\\\n]/g, (c) => `\\${c}`);
  const blocks = chapters.map(
    (c) =>
      `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.startMs)}\nEND=${Math.round(c.endMs)}\ntitle=${escape(c.title)}\n`,
  );
  return `;FFMETADATA1\n${blocks.join("")}`;
}

const secs = (ms: number): string => (Math.max(0, ms) / 1000).toFixed(3);

/** Output frame rate. */
export const FPS = 30;

/**
 * Cut the usable part of one raw scene recording and encode it as H.264.
 * The last frame is held if the recording is a little short, so every
 * segment has exactly the planned length.
 */
export function segmentArgs(input: {
  durationMs: number;
  offsetMs: number;
  out: string;
  size: { height: number; width: number };
  source: string;
}): string[] {
  const { height, width } = input.size;
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    secs(input.offsetMs),
    "-i",
    input.source,
    "-t",
    secs(input.durationMs),
    "-vf",
    `tpad=stop_mode=clone:stop_duration=3,fps=${FPS},scale=${width}:${height}:flags=lanczos,setsar=1,format=yuv420p`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    input.out,
  ];
}

/** File list for ffmpeg's concat demuxer. */
export function concatList(paths: string[]): string {
  return (
    paths.map((p) => `file '${p.replaceAll("'", "'\\''")}'`).join("\n") + "\n"
  );
}

/** Join encoded segments without re-encoding. */
export function concatArgs(listPath: string, out: string): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    out,
  ];
}

/** Container of the final video. */
export type Format = "mp4" | "webm";

/** Encoders for a WebM file. Without `audio` a voiced video cannot be written. */
export interface WebmCodecs {
  audio?: "libopus" | "libvorbis";
  video: "libvpx" | "libvpx-vp9";
}

/**
 * Choose WebM encoders from the output of `ffmpeg -encoders`: VP9 before
 * VP8, Opus before Vorbis. Throws when the build has neither VP9 nor VP8.
 */
export function pickWebmCodecs(encoders: string): WebmCodecs {
  const has = (name: string): boolean =>
    new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m").test(encoders);
  let video: WebmCodecs["video"];
  if (has("libvpx-vp9")) video = "libvpx-vp9";
  else if (has("libvpx")) video = "libvpx";
  else {
    throw new Error(
      "This ffmpeg cannot encode WebM: it has neither libvpx-vp9 nor libvpx. " +
        "Use the ffmpeg-static binary (bun install), or write an MP4.",
    );
  }
  let audio: WebmCodecs["audio"];
  if (has("libopus")) audio = "libopus";
  else if (has("libvorbis")) audio = "libvorbis";
  return { audio, video };
}

/**
 * The file to write and its format. `--format` wins and sets the extension;
 * without it, a `.webm` path means WebM and anything else MP4, adding
 * `.mp4` when the path has another extension.
 */
export function outputTarget(
  path: string,
  format?: Format,
): { format: Format; path: string } {
  const ext = /\.(mp4|webm)$/i.exec(path)?.[1]?.toLowerCase() as
    Format | undefined;
  const chosen = format ?? ext ?? "mp4";
  const stem = ext ? path.slice(0, -(ext.length + 1)) : path;
  return { format: chosen, path: `${stem}.${chosen}` };
}

/** ffmpeg arguments that encode the video stream for a WebM file. */
function webmVideoArgs(codec: WebmCodecs["video"]): string[] {
  // A keyframe every 5 seconds keeps seeking to a chapter quick.
  const common = ["-deadline", "good", "-cpu-used", "4", "-g", String(FPS * 5)];
  return codec === "libvpx-vp9"
    ? ["-c:v", codec, "-crf", "32", "-b:v", "0", "-row-mt", "1", ...common]
    : ["-c:v", codec, "-crf", "10", "-b:v", "4M", ...common];
}

/**
 * Lay the voice clips on the timeline and write the final video.
 *
 * An MP4 copies the H.264 video and always has AAC audio: silence when there
 * are no clips. With `srt` set, the subtitles are added as a soft track. The
 * MP4 muxer marks that track as default (ffmpeg 6.0 sets it even with
 * `-disposition 0`), so a player may show it on its own. Leave `srt` unset
 * when captions are already burned into the picture, or they show twice.
 *
 * A WebM re-encodes the video as VP9 (VP8 when the ffmpeg build has no VP9),
 * has Opus audio only when there are clips, and never has a subtitle track;
 * a web player loads the .vtt file beside it.
 */
export function muxArgs(input: {
  /** ffmetadata file with chapter markers. */
  chapters?: string;
  clips: { path: string; startMs: number }[];
  /** Default mp4. */
  format?: Format;
  out: string;
  srt?: string;
  totalMs: number;
  video: string;
  /** Encoders to use; required for WebM. */
  webm?: WebmCodecs;
}): string[] {
  const webm = input.format === "webm";
  if (webm && !input.webm) throw new Error("WebM output needs `webm` codecs");
  if (webm && input.srt) {
    throw new Error("A WebM file carries no subtitle track; leave `srt` unset");
  }
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", input.video];
  const n = input.clips.length;
  const rate = webm ? 48000 : 44100; // Opus takes 48 kHz, not 44.1 kHz
  const format = `aformat=sample_rates=${rate}:channel_layouts=stereo[aout]`;
  let filter: string | undefined;
  if (n === 0) {
    if (!webm) {
      args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
      filter = `[1:a]${format}`;
    }
  } else {
    for (const clip of input.clips) args.push("-i", clip.path);
    const delayed = input.clips
      .map(
        (clip, i) =>
          `[${i + 1}:a]adelay=delays=${Math.round(clip.startMs)}:all=1[a${i}]`,
      )
      .join(";");
    const labels = input.clips.map((_, i) => `[a${i}]`).join("");
    const mix =
      n === 1
        ? `${labels}anull`
        : `${labels}amix=inputs=${n}:normalize=0:dropout_transition=0`;
    filter = `${delayed};${mix},apad,${format}`;
  }
  let next = filter && n === 0 ? 2 : n + 1;
  const subIndex = next;
  if (input.srt) {
    args.push("-i", input.srt);
    next++;
  }
  if (input.chapters) args.push("-f", "ffmetadata", "-i", input.chapters);
  if (filter) args.push("-filter_complex", filter);
  args.push("-map", "0:v");
  if (filter) args.push("-map", "[aout]");
  if (input.srt) args.push("-map", `${subIndex}:s`);
  if (input.chapters) args.push("-map_chapters", String(next));
  if (webm && input.webm) {
    args.push(...webmVideoArgs(input.webm.video));
    if (filter) {
      const audio = input.webm.audio;
      if (!audio) {
        throw new Error(
          "This ffmpeg has no Opus or Vorbis encoder, so it cannot write voice into a WebM.",
        );
      }
      args.push(
        "-c:a",
        audio,
        ...(audio === "libopus" ? ["-b:a", "128k"] : ["-q:a", "5"]),
      );
    }
    args.push("-t", secs(input.totalMs), input.out);
    return args;
  }
  args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "160k");
  if (input.srt)
    args.push("-c:s", "mov_text", "-metadata:s:s:0", "language=eng");
  args.push("-t", secs(input.totalMs), "-movflags", "+faststart", input.out);
  return args;
}

/** Parse "Duration: HH:MM:SS.xx" from ffmpeg's stderr, in ms. */
export function parseDuration(stderr: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return undefined;
  return Math.round(
    (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000,
  );
}
