/**
 * The cache key for a voice clip.
 *
 * A clip is reused when the text, the voice, the model, the output format,
 * every voice setting and the pronunciation dictionaries are the same. Anything else changes the key, so an edit
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

/** A pronunciation dictionary as the text-to-speech request names it. */
export type DictionaryLocator = {
  pronunciation_dictionary_id: string;
  version_id: string;
};

/**
 * The script's pronunciation dictionaries as the request's
 * `pronunciation_dictionary_locators`, in the script's order (ElevenLabs
 * applies them in order). Empty when the script names none.
 */
export function dictionaryLocators(voice: VoiceConfig): DictionaryLocator[] {
  return (voice.pronunciation_dictionaries ?? []).map((d) => ({
    pronunciation_dictionary_id: d.id,
    version_id: d.version_id,
  }));
}

/** A stable sha256 hex key for one clip. Key order in the input does not matter. */
export function clipCacheKey(text: string, voice: VoiceConfig): string {
  const settings = voiceSettings(voice);
  const sorted = Object.fromEntries(
    Object.keys(settings)
      .sort()
      .map((k) => [k, settings[k]]),
  );
  const dictionaries = dictionaryLocators(voice);
  const material = JSON.stringify({
    // Only when the script names dictionaries, so a script without them
    // keeps the keys, and the cached clips, it had before they existed.
    ...(dictionaries.length > 0 ? { dictionaries } : {}),
    model: voice.model_id,
    format: voice.output_format,
    provider: voice.provider,
    settings: sorted,
    text: text.trim(),
    voice: voice.voice_id,
  });
  return createHash("sha256").update(material).digest("hex");
}
