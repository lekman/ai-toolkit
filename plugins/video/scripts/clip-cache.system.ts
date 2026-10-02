/**
 * Voice clips on disk: `<dir>/<key>.mp3` with a `<key>.json` beside it that
 * holds the measured length.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { CachedClip, IClipCache } from "./interfaces.ts";

/** Default cache folder: $XDG_CACHE_HOME/storybook-video/voice, or ~/.cache/... */
export function defaultCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "storybook-video", "voice");
}

/** Clip cache in one folder. */
export class DiskClipCache implements IClipCache {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  /** The cached clip, if both the audio and its length are on disk. */
  lookup(key: string): CachedClip | undefined {
    const path = join(this.#dir, `${key}.mp3`);
    const meta = join(this.#dir, `${key}.json`);
    if (!existsSync(path) || !existsSync(meta)) return undefined;
    try {
      const { durationMs } = JSON.parse(readFileSync(meta, "utf8")) as {
        durationMs: number;
      };
      return typeof durationMs === "number" ? { durationMs, path } : undefined;
    } catch {
      return undefined;
    }
  }

  /** Write the measured length. */
  remember(key: string, durationMs: number): void {
    writeFileSync(
      join(this.#dir, `${key}.json`),
      JSON.stringify({ durationMs }),
    );
  }

  /** Write the audio. */
  write(key: string, audio: Uint8Array): string {
    mkdirSync(this.#dir, { recursive: true });
    const path = join(this.#dir, `${key}.mp3`);
    writeFileSync(path, audio);
    return path;
  }
}
