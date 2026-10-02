import { describe, expect, test } from "bun:test";

import type {
  CachedClip,
  IClipCache,
  IMediaProbe,
  ISpeechClient,
} from "../scripts/interfaces.ts";

import { clipCacheKey } from "../scripts/cache-key.ts";
import { parseScript, type VoiceConfig } from "../scripts/script.ts";
import { stepKey } from "../scripts/timing.ts";
import { Voice } from "../scripts/voice.ts";

class MemoryCache implements IClipCache {
  clips = new Map<string, CachedClip>();
  lookup(key: string): CachedClip | undefined {
    return this.clips.get(key);
  }
  remember(key: string, durationMs: number): void {
    const clip = this.clips.get(key);
    if (clip) clip.durationMs = durationMs;
  }
  write(key: string): string {
    const path = `/cache/${key}.mp3`;
    this.clips.set(key, { durationMs: -1, path });
    return path;
  }
}

class FakeClient implements ISpeechClient {
  calls: string[] = [];
  async synthesize(text: string): Promise<Uint8Array> {
    this.calls.push(text);
    return new TextEncoder().encode(text);
  }
}

const probe: IMediaProbe = { durationMs: async () => 2100 };

const script = parseScript(`
title: T
output: o.mp4
storybook: ./sb
voice: { provider: elevenlabs, voice_id: DODLEQrClDo8wCz460ld }
scenes:
  - story: a--b
    steps:
      - say: First line.
      - do: wait
      - say: Second line.
`);
const voice = script.voice as VoiceConfig;

describe("Voice.prepare", () => {
  test("generates every missing clip, then reuses all of them", async () => {
    const cache = new MemoryCache();
    const client = new FakeClient();
    const first = await Voice.prepare(script, {
      cache,
      client: async () => client,
      probe,
    });
    expect(client.calls).toEqual(["First line.", "Second line."]);
    expect(first.generated).toBe(2);
    expect(first.clips.get(stepKey(0, 2))?.durationMs).toBe(2100);
    expect(first.clips.has(stepKey(0, 1))).toBe(false);

    let created = 0;
    const second = await Voice.prepare(script, {
      cache,
      client: async () => {
        created++;
        return client;
      },
      probe,
    });
    expect(second).toMatchObject({ generated: 0, reused: 2 });
    expect(created).toBe(0); // no client, so no API key needed
    expect(client.calls.length).toBe(2);
  });

  test("an edited line regenerates only that line", async () => {
    const cache = new MemoryCache();
    cache.clips.set(clipCacheKey("First line.", voice), {
      durationMs: 1000,
      path: "/a.mp3",
    });
    const client = new FakeClient();
    const result = await Voice.prepare(script, {
      cache,
      client: async () => client,
      probe,
    });
    expect(client.calls).toEqual(["Second line."]);
    expect(result).toMatchObject({ generated: 1, reused: 1 });
  });

  test("a script without a voice block makes no clips", async () => {
    const silent = parseScript(`
title: T
output: o.mp4
scenes: [{ url: "https://example.com", steps: [{ say: Hi. }] }]
`);
    const result = await Voice.prepare(silent, {
      cache: new MemoryCache(),
      client: async () => {
        throw new Error("must not be called");
      },
      probe,
    });
    expect(result.clips.size).toBe(0);
  });
});

describe("Voice.lengthsFromCache", () => {
  test("uses cached lengths and estimates the rest", () => {
    const cache = new MemoryCache();
    cache.clips.set(clipCacheKey("First line.", voice), {
      durationMs: 1234,
      path: "/a.mp3",
    });
    const lengths = Voice.lengthsFromCache(script, cache);
    expect(lengths.get(stepKey(0, 0))).toEqual({ estimated: false, ms: 1234 });
    expect(lengths.get(stepKey(0, 2))).toEqual({ estimated: true, ms: 800 });
    expect(lengths.has(stepKey(0, 1))).toBe(false);
  });
});
