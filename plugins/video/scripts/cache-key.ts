/**
 * The cache key for a voice clip.
 *
 * A clip is reused when the text, the voice, the model, the output format and
 * every voice setting are the same. Anything else changes the key, so an edit
 * to one line regenerates only that line.
 */

import { createHash } from "node:crypto";

import type { VoiceConfig } from "./script.ts";

/** Voice settings sent to the provider, without the fields that are not settings. */
export function voiceSettings(
  voice: VoiceConfig,
): Record<string, boolean | number> {
  const settings: Record<string, boolean | number> = {};
  for (const name of [
    "similarity_boost",
    "speed",
    "stability",
    "style",
    "use_speaker_boost",
  ] as const) {
    const value = voice[name];
    if (value !== undefined) settings[name] = value;
  }
  return settings;
}

/** A stable sha256 hex key for one clip. Key order in the input does not matter. */
export function clipCacheKey(text: string, voice: VoiceConfig): string {
  const settings = voiceSettings(voice);
  const sorted = Object.fromEntries(
    Object.keys(settings)
      .sort()
      .map((k) => [k, settings[k]]),
  );
  const material = JSON.stringify({
    model: voice.model_id,
    format: voice.output_format,
    provider: voice.provider,
    settings: sorted,
    text: text.trim(),
    voice: voice.voice_id,
  });
  return createHash("sha256").update(material).digest("hex");
}
