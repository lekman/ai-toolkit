/**
 * Voice clips for every spoken step: reuse what the cache holds, generate the
 * rest, and measure each clip so the timing plan can use its real length.
 */

import type {
  CachedClip,
  IClipCache,
  IMediaProbe,
  ISpeechClient,
} from "./interfaces.ts";
import type { VideoScript } from "./script.ts";

import { clipCacheKey } from "./cache-key.ts";
import { estimateSpeechMs, stepKey, type VoiceLengths } from "./timing.ts";

/** Clips per step, and how many were generated against reused. */
export interface PreparedVoice {
  clips: Map<string, CachedClip>;
  generated: number;
  reused: number;
}

/** Spoken lines in a script, with their step keys. */
function spokenSteps(script: VideoScript): { key: string; text: string }[] {
  return script.scenes.flatMap((scene, si) =>
    scene.steps.flatMap((step, pi) =>
      step.say ? [{ key: stepKey(si, pi), text: step.say }] : [],
    ),
  );
}

/** Groups the voice operations. */
export class Voice {
  /**
   * Voice lengths for a dry run: the measured length of each cached clip, and
   * an estimate for each clip that does not exist yet. Makes no API calls.
   */
  static lengthsFromCache(
    script: VideoScript,
    cache: IClipCache,
  ): VoiceLengths {
    const lengths: VoiceLengths = new Map();
    const voice = script.voice;
    for (const { key, text } of spokenSteps(script)) {
      const hit = voice ? cache.lookup(clipCacheKey(text, voice)) : undefined;
      lengths.set(
        key,
        hit
          ? { estimated: false, ms: hit.durationMs }
          : { estimated: true, ms: estimateSpeechMs(text) },
      );
    }
    return lengths;
  }

  /**
   * Make sure every spoken step has a clip. The client is created only when at
   * least one clip is missing, so a fully cached run needs no API key.
   */
  static async prepare(
    script: VideoScript,
    deps: {
      cache: IClipCache;
      client: () => Promise<ISpeechClient>;
      probe: IMediaProbe;
    },
  ): Promise<PreparedVoice> {
    const voice = script.voice;
    const clips = new Map<string, CachedClip>();
    if (!voice) return { clips, generated: 0, reused: 0 };
    let client: ISpeechClient | undefined;
    let generated = 0;
    let reused = 0;
    for (const { key, text } of spokenSteps(script)) {
      const cacheKey = clipCacheKey(text, voice);
      const hit = deps.cache.lookup(cacheKey);
      if (hit) {
        clips.set(key, hit);
        reused++;
        continue;
      }
      client ??= await deps.client();
      const audio = await client.synthesize(text, voice);
      const path = deps.cache.write(cacheKey, audio);
      const durationMs = await deps.probe.durationMs(path);
      deps.cache.remember(cacheKey, durationMs);
      clips.set(key, { durationMs, path });
      generated++;
    }
    return { clips, generated, reused };
  }

  /** Voice lengths from prepared clips, for the timing plan. */
  static lengthsFromClips(clips: Map<string, CachedClip>): VoiceLengths {
    const lengths: VoiceLengths = new Map();
    for (const [key, clip] of clips)
      lengths.set(key, { estimated: false, ms: clip.durationMs });
    return lengths;
  }
}
