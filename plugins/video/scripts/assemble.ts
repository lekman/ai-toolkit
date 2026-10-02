/**
 * Turn recorded scenes into one timeline, and build the ffmpeg arguments that
 * cut, join and mux the final video. Pure: nothing here runs ffmpeg.
 */

import type { Cue } from "./subtitles.ts";

/** One scene as recorded, with times relative to the moment the scene was ready. */
export interface RecordedScene {
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

/** The whole video on one clock. */
export interface Timeline {
  cues: Cue[];
  sceneStarts: number[];
  /** Global start of each step, keyed by `scene:step`. */
  stepStarts: Map<string, number>;
  totalMs: number;
}

/** Place every scene end to end and move captions and steps onto the global clock. */
export function buildTimeline(scenes: RecordedScene[]): Timeline {
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
    t += scene.durationMs;
  }
  return { cues, sceneStarts, stepStarts, totalMs: t };
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

/**
 * Lay the voice clips on the timeline and write the MP4. With no clips, the
 * audio track is silence, so every output has H.264 video and AAC audio.
 *
 * With `srt` set, the subtitles are added as a soft track. The MP4 muxer
 * marks that track as default (ffmpeg 6.0 sets it even with
 * `-disposition 0`), so a player may show it on its own. Leave `srt` unset
 * when captions are already burned into the picture, or they show twice.
 */
export function muxArgs(input: {
  clips: { path: string; startMs: number }[];
  out: string;
  srt?: string;
  totalMs: number;
  video: string;
}): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", input.video];
  const n = input.clips.length;
  let filter: string;
  if (n === 0) {
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
    filter = "[1:a]aformat=sample_rates=44100:channel_layouts=stereo[aout]";
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
    filter = `${delayed};${mix},apad,aformat=sample_rates=44100:channel_layouts=stereo[aout]`;
  }
  const subIndex = n === 0 ? 2 : n + 1;
  if (input.srt) args.push("-i", input.srt);
  args.push("-filter_complex", filter, "-map", "0:v", "-map", "[aout]");
  if (input.srt) args.push("-map", `${subIndex}:s`);
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
