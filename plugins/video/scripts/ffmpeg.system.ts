/**
 * Find and run ffmpeg.
 *
 * Order: FFMPEG_PATH, then the binary the ffmpeg-static package downloads at
 * install time, then `ffmpeg` on PATH (for example from `brew install ffmpeg`).
 */

import {
  execFileSync,
  spawnSync,
  type SpawnSyncReturns,
} from "node:child_process";
import { existsSync } from "node:fs";

import type { IMediaProbe } from "./interfaces.ts";

import { parseDuration } from "./assemble.ts";

/** Path of the ffmpeg binary to use. Throws with install advice when none is found. */
export async function findFfmpeg(): Promise<string> {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv) {
    if (existsSync(fromEnv)) return fromEnv;
    throw new Error(`FFMPEG_PATH points at ${fromEnv}, which does not exist.`);
  }
  try {
    const mod = (await import("ffmpeg-static")) as { default: string | null };
    if (mod.default && existsSync(mod.default)) return mod.default;
  } catch {
    // Package not installed; fall through to PATH.
  }
  try {
    const found = execFileSync("which", ["ffmpeg"], {
      encoding: "utf8",
    }).trim();
    if (found) return found;
  } catch {
    // Not on PATH.
  }
  throw new Error(
    "No ffmpeg found. Run `bun install` in the video plugin folder (it downloads ffmpeg-static), " +
      "install one with `brew install ffmpeg`, or set FFMPEG_PATH.",
  );
}

/**
 * Run ffmpeg and wait for it. Every ffmpeg call is synchronous: under Bun on
 * Linux, an async child's exit was seen to go unreported now and then after
 * a recording, with ffmpeg finished and its output written, so the run
 * waited for ever. Nothing else needs the event loop while ffmpeg runs.
 */
function ffmpegSync(bin: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Run ffmpeg; reject with its stderr on failure. */
export function runFfmpeg(bin: string, args: string[]): Promise<void> {
  const res = ffmpegSync(bin, args);
  if (res.status === 0) return Promise.resolve();
  const why = res.error?.message ?? (res.stderr ?? "").trim();
  return Promise.reject(
    new Error(`ffmpeg failed: ${why.split("\n").slice(-5).join("\n")}`),
  );
}

/** Media probe that reads the length from ffmpeg's header output. */
export class FfmpegProbe implements IMediaProbe {
  readonly #bin: string;

  constructor(bin: string) {
    this.#bin = bin;
  }

  /** Length of a media file in ms. */
  durationMs(path: string): Promise<number> {
    // With no output file ffmpeg exits non-zero, but still prints the header.
    const ms = parseDuration(
      ffmpegSync(this.#bin, ["-hide_banner", "-i", path]).stderr ?? "",
    );
    return ms === undefined
      ? Promise.reject(new Error(`Could not read the length of ${path}`))
      : Promise.resolve(ms);
  }
}

/** The encoder list ffmpeg prints with `-encoders`. */
export function listEncoders(bin: string): Promise<string> {
  const res = ffmpegSync(bin, ["-hide_banner", "-encoders"]);
  return res.status === 0
    ? Promise.resolve(res.stdout)
    : Promise.reject(new Error("ffmpeg -encoders failed"));
}
