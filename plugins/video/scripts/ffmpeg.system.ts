/**
 * Find and run ffmpeg.
 *
 * Order: FFMPEG_PATH, then the binary the ffmpeg-static package downloads at
 * install time, then `ffmpeg` on PATH (for example from `brew install ffmpeg`).
 */

import { execFile, execFileSync } from "node:child_process";
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

/** Run ffmpeg; reject with its stderr on failure. */
export function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { maxBuffer: 32 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `ffmpeg failed: ${stderr.trim().split("\n").slice(-5).join("\n")}`,
            ),
          );
        else resolve();
      },
    );
  });
}

/** Media probe that reads the length from ffmpeg's header output. */
export class FfmpegProbe implements IMediaProbe {
  readonly #bin: string;

  constructor(bin: string) {
    this.#bin = bin;
  }

  /** Length of a media file in ms. */
  durationMs(path: string): Promise<number> {
    return new Promise((resolve, reject) => {
      // With no output file ffmpeg exits non-zero, but still prints the header.
      execFile(
        this.#bin,
        ["-hide_banner", "-i", path],
        (_error, _stdout, stderr) => {
          const ms = parseDuration(stderr);
          if (ms === undefined)
            reject(new Error(`Could not read the length of ${path}`));
          else resolve(ms);
        },
      );
    });
  }
}
