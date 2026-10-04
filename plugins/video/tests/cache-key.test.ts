import { describe, expect, test } from "bun:test";

import type { VoiceConfig } from "../scripts/script.ts";

import { clipCacheKey, dictionaryLocators } from "../scripts/cache-key.ts";

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
  test("changes with the pronunciation dictionaries and their versions", () => {
    const dict = { id: "d1", version_id: "v1" };
    const base = clipCacheKey("Hello.", voice);
    const one = clipCacheKey("Hello.", {
      ...voice,
      pronunciation_dictionaries: [dict],
    });
    const newer = clipCacheKey("Hello.", {
      ...voice,
      pronunciation_dictionaries: [{ ...dict, version_id: "v2" }],
    });
    expect(one).not.toBe(base);
    expect(newer).not.toBe(one);
  });
  test("keeps the key it had before dictionaries existed", () => {
    // The key main produced for this clip before the dictionaries setting,
    // so scripts without dictionaries keep their cached clips.
    expect(clipCacheKey("Hello.", voice)).toBe(
      "d7df17f3983126a2b4743a6177a5dba711e9eba208305a97f3220f494c384f86",
    );
  });
});

describe("dictionaryLocators", () => {
  test("names each dictionary the way the request expects, in order", () => {
    expect(
      dictionaryLocators({
        ...voice,
        pronunciation_dictionaries: [
          { id: "a", version_id: "1" },
          { id: "b", version_id: "2" },
        ],
      }),
    ).toEqual([
      { pronunciation_dictionary_id: "a", version_id: "1" },
      { pronunciation_dictionary_id: "b", version_id: "2" },
    ]);
  });
  test("is empty without dictionaries", () => {
    expect(dictionaryLocators(voice)).toEqual([]);
  });
});
