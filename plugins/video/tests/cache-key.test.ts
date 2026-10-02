import { describe, expect, test } from "bun:test";

import type { VoiceConfig } from "../scripts/script.ts";

import { clipCacheKey } from "../scripts/cache-key.ts";

const voice: VoiceConfig = {
  model_id: "eleven_multilingual_v2",
  output_format: "mp3_44100_128",
  provider: "elevenlabs",
  stability: 0.5,
  style: 0,
  voice_id: "DODLEQrClDo8wCz460ld",
};

describe("clipCacheKey", () => {
  test("is a stable sha256 hex string", () => {
    const key = clipCacheKey("Hello.", voice);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(clipCacheKey("Hello.", voice)).toBe(key);
  });
  test("ignores surrounding whitespace in the text", () => {
    expect(clipCacheKey("  Hello. ", voice)).toBe(
      clipCacheKey("Hello.", voice),
    );
  });
  test("does not depend on key order", () => {
    const reordered = {
      voice_id: voice.voice_id,
      style: 0,
      stability: 0.5,
      provider: "elevenlabs",
      output_format: voice.output_format,
      model_id: voice.model_id,
    } as VoiceConfig;
    expect(clipCacheKey("Hello.", reordered)).toBe(
      clipCacheKey("Hello.", voice),
    );
  });
  test("changes with the text, voice, model, format and each setting", () => {
    const base = clipCacheKey("Hello.", voice);
    const variants = [
      clipCacheKey("Hello!", voice),
      clipCacheKey("Hello.", { ...voice, voice_id: "other" }),
      clipCacheKey("Hello.", { ...voice, model_id: "eleven_flash_v2_5" }),
      clipCacheKey("Hello.", { ...voice, output_format: "mp3_22050_32" }),
      clipCacheKey("Hello.", { ...voice, stability: 0.6 }),
      clipCacheKey("Hello.", { ...voice, speed: 1.1 }),
    ];
    for (const v of variants) expect(v).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
  });
});
