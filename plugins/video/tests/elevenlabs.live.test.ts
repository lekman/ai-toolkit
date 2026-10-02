/**
 * One real call to ElevenLabs. Skipped unless ELEVENLABS_API_KEY or
 * ELEVENLABS_API_KEY_REF is set, so CI never runs it. Costs about 40
 * characters of quota per run.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveApiKey } from "../scripts/credentials.ts";
import { ElevenLabsClient, opRead } from "../scripts/elevenlabs.system.ts";
import { FfmpegProbe, findFfmpeg } from "../scripts/ffmpeg.system.ts";
import { parseScript } from "../scripts/script.ts";

const configured = Boolean(
  process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY_REF,
);

describe.skipIf(!configured)("ElevenLabs, live", () => {
  test("turns one line into an mp3 that ffmpeg can measure", async () => {
    const script = parseScript(`
title: Live
output: o.mp4
voice: { provider: elevenlabs, voice_id: DODLEQrClDo8wCz460ld }
scenes: [{ url: "https://example.com", steps: [{ say: x }] }]
`);
    const client = new ElevenLabsClient(
      await resolveApiKey(process.env, opRead),
    );
    const audio = await client.synthesize(
      "This line checks the voice path.",
      script.voice!,
    );
    expect(audio.byteLength).toBeGreaterThan(5000);
    const path = join(mkdtempSync(join(tmpdir(), "sbv-live-")), "clip.mp3");
    writeFileSync(path, audio);
    const ms = await new FfmpegProbe(await findFfmpeg()).durationMs(path);
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(6000);
  }, 150_000);
});
