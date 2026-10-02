/**
 * Ports between the logic and the outside world. The `*.system.ts` files
 * implement them; tests pass in fakes.
 */

import type { VoiceConfig } from "./script.ts";

/** Turns text into speech audio. */
export interface ISpeechClient {
  /** Audio bytes in the format named by `voice.output_format`. */
  synthesize(text: string, voice: VoiceConfig): Promise<Uint8Array>;
}

/** A clip on disk and its length. */
export interface CachedClip {
  durationMs: number;
  path: string;
}

/** Voice clips on disk, keyed by cache key. */
export interface IClipCache {
  /** The clip for a key, or undefined when it has not been generated. */
  lookup(key: string): CachedClip | undefined;
  /** Record the measured length of a clip written with `write`. */
  remember(key: string, durationMs: number): void;
  /** Write audio for a key and return its path. */
  write(key: string, audio: Uint8Array): string;
}

/** Measures media length. */
export interface IMediaProbe {
  /** Length of an audio or video file, in ms. */
  durationMs(path: string): Promise<number>;
}
