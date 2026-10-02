/**
 * End to end: record the fixture pages into a real MP4 with Chromium and
 * ffmpeg. The voice test points the ElevenLabs client at a local stand-in,
 * so no test reaches the real API.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findFfmpeg } from "../scripts/ffmpeg.system.ts";
import { launchBrowser } from "../scripts/record.system.ts";

const CLI = join(import.meta.dir, "..", "scripts", "cli.ts");
const FIXTURES = join(import.meta.dir, "fixtures");
const SECRET = "sk-test-0123456789-never-print-me";

const ffmpeg = await findFfmpeg().catch(() => "");
// Skip, rather than fail, on a machine with no browser for Playwright.
const browserReady = await launchBrowser(false)
  .then(async (b) => {
    await b.close();
    return true;
  })
  .catch(() => false);

// Async, so the stand-in API served from this process can answer while the
// CLI runs. A synchronous spawn would block it and hang the run.
async function run(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: {
      ...process.env,
      ELEVENLABS_API_KEY: "",
      ELEVENLABS_API_KEY_REF: "",
      ...env,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: `${out}${err}` };
}

function streams(file: string): string {
  const res = spawnSync(ffmpeg, ["-hide_banner", "-i", file], {
    encoding: "utf8",
  });
  return res.stderr;
}

describe.skipIf(!ffmpeg || !browserReady)("render", () => {
  test("records the fixture pages with --no-voice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sbv-it-"));
    const out = join(dir, "tour.mp4");
    const res = await run([
      join(FIXTURES, "render.yaml"),
      "--no-voice",
      "--out",
      out,
    ]);
    expect(res.code).toBe(0);
    const info = streams(out);
    expect(info).toMatch(/Video: h264/);
    expect(info).toMatch(/Audio: aac/);
    expect(info).toMatch(/640x360/);
    const seconds = Number(/Duration: 00:00:(\d+\.\d+)/.exec(info)?.[1]);
    expect(seconds).toBeGreaterThan(8);
    expect(seconds).toBeLessThan(14);

    const srt = readFileSync(join(dir, "tour.srt"), "utf8");
    expect(srt.match(/-->/g)?.length).toBe(3);
    expect(srt).toContain("Click Approve when the case is correct.");
    expect(
      readFileSync(join(dir, "tour.vtt"), "utf8").startsWith("WEBVTT"),
    ).toBe(true);
    expect(readFileSync(join(dir, "tour.md"), "utf8")).toContain(
      "## 2. Find a case",
    );
  }, 180_000);

  test("a missing target fails with the scene and step named", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sbv-it-"));
    const script = join(dir, "bad.yaml");
    writeFileSync(
      script,
      `title: Bad\noutput: bad.mp4\nstorybook: ${join(FIXTURES, "site")}\nscenes:\n  - url: form.html\n    steps:\n      - { say: Click it., do: click, target: "#does-not-exist" }\n`,
    );
    const res = await run([script, "--no-voice"]);
    expect(res.code).toBe(1);
    expect(res.out).toContain(
      "Scene 1, step 1 (click on #does-not-exist) failed",
    );
  }, 60_000);

  describe("with voice from a stand-in API", () => {
    let server: ReturnType<typeof Bun.serve>;
    const requests: { key: string | null; text: string; url: string }[] = [];
    let tone: Blob;

    beforeAll(() => {
      const mp3 = join(mkdtempSync(join(tmpdir(), "sbv-tone-")), "tone.mp3");
      execFileSync(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2.5",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k",
        mp3,
      ]);
      tone = new Blob([readFileSync(mp3)]);
      server = Bun.serve({
        async fetch(req) {
          const body = (await req.json()) as { text: string };
          requests.push({
            key: req.headers.get("xi-api-key"),
            text: body.text,
            url: req.url,
          });
          return new Response(tone, {
            headers: { "content-type": "audio/mpeg" },
          });
        },
        port: 0,
      });
    });
    afterAll(() => server.stop(true));

    test("generates each line once, reuses the cache, and never prints the key", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sbv-it-"));
      const script = join(dir, "voiced.yaml");
      const text = readFileSync(join(FIXTURES, "render.yaml"), "utf8")
        .replace("storybook: ./site", `storybook: ${join(FIXTURES, "site")}`)
        .replace(
          "subtitles: { burn: true }",
          "subtitles: { burn: false }\nvoice: { provider: elevenlabs, voice_id: DODLEQrClDo8wCz460ld, stability: 0.5 }",
        );
      writeFileSync(script, text);
      const env = {
        ELEVENLABS_API_KEY: SECRET,
        ELEVENLABS_API_URL: server.url.origin,
      };
      const cache = join(dir, "cache");

      const first = await run([script, "--cache-dir", cache], env);
      expect(first.code).toBe(0);
      expect(first.out).toContain("3 clip(s) generated, 0 reused");
      expect(first.out).not.toContain(SECRET);
      expect(requests.length).toBe(3);
      expect(requests.every((r) => r.key === SECRET)).toBe(true);
      expect(requests[0]?.url).toContain(
        "/v1/text-to-speech/DODLEQrClDo8wCz460ld?output_format=mp3_44100_128",
      );

      const info = streams(join(dir, "out", "fixture-tour.mp4"));
      expect(info).toMatch(/Audio: aac/);
      expect(info).toMatch(/Subtitle: mov_text/);
      // Each 2.5 s clip sets its step to 2.9 s, so the video is longer than the silent one.
      const seconds = Number(/Duration: 00:00:(\d+\.\d+)/.exec(info)?.[1]);
      expect(seconds).toBeGreaterThan(10.5);

      const second = await run([script, "--cache-dir", cache, "--dry-run"], {
        ELEVENLABS_API_URL: server.url.origin,
      });
      expect(second.code).toBe(0);
      expect(second.out).toContain("Every voice clip is cached");

      const third = await run([script, "--cache-dir", cache], {
        ELEVENLABS_API_URL: server.url.origin,
      });
      expect(third.code).toBe(0); // no key set: every clip is cached, so none is needed
      expect(third.out).toContain("0 clip(s) generated, 3 reused");
      expect(requests.length).toBe(3);
    }, 300_000);

    test("without a key and an uncached line, the run stops before recording", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sbv-it-"));
      const script = join(dir, "nokey.yaml");
      writeFileSync(
        script,
        `title: No key\noutput: x.mp4\nvoice: { provider: elevenlabs, voice_id: abc }\nscenes:\n  - url: "file:///dev/null"\n    steps: [{ say: A line that is not cached. }]\n`,
      );
      const res = await run([script, "--cache-dir", join(dir, "cache")]);
      expect(res.code).toBe(2);
      expect(res.out).toContain("No ElevenLabs API key is available.");
      expect(res.out).not.toContain("Recording scene");
    });
  });
});
