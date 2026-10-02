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
import { serveFolder } from "../scripts/serve.system.ts";

const CLI = join(import.meta.dir, "..", "scripts", "cli.ts");
const FIXTURES = join(import.meta.dir, "fixtures");
const SITE = join(FIXTURES, "site");

/** A timestamped line on stderr, to show on CI where a slow test spends its time. */
const mark = (what: string): void =>
  console.error(`[${new Date().toISOString()}] ${what}`);
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
// CLI runs. A synchronous spawn would block it and hang the run. A run that
// has not finished within `limitMs` is killed, and the error shows its output
// so far, so a hang on CI says where it stopped.
async function run(
  args: string[],
  env: Record<string, string> = {},
  limitMs = 90_000,
) {
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
  // Collected as it arrives, so a run that is stopped still shows its log.
  const chunks: string[] = [];
  const collect = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      chunks.push(decoder.decode(value));
    }
  };
  const output = Promise.all([collect(proc.stdout), collect(proc.stderr)]);
  let pipesClosed = false;
  void output.then(() => (pipesClosed = true));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<"timeout">((r) => {
    timer = setTimeout(() => r("timeout"), limitMs);
  });
  const done = await Promise.race([Promise.all([output, proc.exited]), limit]);
  clearTimeout(timer);
  if (done === "timeout") {
    const closedBefore = pipesClosed;
    const exitedBefore = proc.exitCode !== null;
    const ps = spawnSync("ps", ["-eo", "pid,ppid,stat,etime,wchan:20,args"], {
      encoding: "utf8",
    }).stdout;
    proc.kill("SIGKILL");
    throw new Error(
      `The CLI did not finish in ${limitMs} ms (pipes ${closedBefore ? "closed" : "open"}, process ${exitedBefore ? `exited with ${proc.exitCode}` : "running"}). Output so far:\n${chunks.join("")}\nProcesses:\n${ps}`,
    );
  }
  const code = done[1];
  return { code, out: chunks.join("") };
}

/** Start times of the cues in a WebVTT file, in seconds. */
function cueStarts(vtt: string): number[] {
  return [...vtt.matchAll(/^(\d\d):(\d\d):(\d\d\.\d+) -->/gm)].map(
    (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]),
  );
}

/**
 * Load a video in Chromium's <video> element with its WebVTT file as a
 * track. Resolves when it can play, with its length and the track's cues.
 */
async function playInChromium(
  dir: string,
  video: string,
  vtt: string,
): Promise<{ cues: number; duration: number }> {
  writeFileSync(
    join(dir, "play.html"),
    `<!doctype html><video src="${video}" preload="auto" muted><track kind="subtitles" srclang="en" src="${vtt}" default></video>`,
  );
  const server = await serveFolder(dir);
  const browser = await launchBrowser(false);
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}play.html`);
    return await page.evaluate(
      () =>
        new Promise<{ cues: number; duration: number }>((resolve, reject) => {
          const v = document.querySelector("video") as HTMLVideoElement;
          const track = document.querySelector("track") as HTMLTrackElement;
          const timer = setTimeout(
            () => reject(new Error("the video never reached canplay")),
            20_000,
          );
          v.addEventListener("error", () =>
            reject(new Error(`media error ${v.error?.code}`)),
          );
          const loaded = new Promise((r) => {
            if (track.readyState === 2) r(null);
            else track.addEventListener("load", r);
          });
          const playable = new Promise((r) => {
            if (v.readyState >= 3) r(null);
            else v.addEventListener("canplay", r);
          });
          void Promise.all([loaded, playable]).then(() => {
            clearTimeout(timer);
            resolve({
              cues: track.track.cues?.length ?? 0,
              duration: v.duration,
            });
          });
        }),
    );
  } finally {
    await browser.close();
    await server.close();
  }
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

  test("an intro card comes first and shifts the subtitles, with chapters in the MP4", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sbv-it-"));
    const script = join(dir, "intro.yaml");
    const text = readFileSync(join(FIXTURES, "render.yaml"), "utf8")
      .replace("storybook: ./site", `storybook: ${join(FIXTURES, "site")}`)
      .replace(
        "title: Fixture tour",
        `title: Fixture tour\nintro: { logo: ${join(FIXTURES, "logo.svg")}, duration: 2, subtitle: A short test }`,
      );
    writeFileSync(script, text);
    const out = join(dir, "intro.mp4");
    const res = await run([script, "--no-voice", "--out", out]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("Recording the intro card");

    const info = streams(out);
    const seconds = Number(/Duration: 00:00:(\d+\.\d+)/.exec(info)?.[1]);
    expect(seconds).toBeGreaterThan(10);
    expect(info).toContain("Chapter #0:0: start 0.000000, end 2.000000");
    expect(info).toMatch(/title\s*: Fixture tour/);
    expect(info).toMatch(/title\s*: Approve a case/);

    const srt = readFileSync(join(dir, "intro.srt"), "utf8");
    // Without the intro the first cue starts at about 0.8 s.
    expect(srt).toMatch(/^1\n00:00:02,[89]\d\d -->/);
    expect(readFileSync(join(dir, "intro.md"), "utf8")).toContain(
      "## 1. Approve a case [0:02.0]",
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

  test("a WebM joined from two segments plays in Chromium, with storage kept across scenes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sbv-it-"));
    const frame = `'iframe[title="Chart"]'`;
    // A whole script, so the segment can also be recorded on its own.
    writeFileSync(
      join(dir, "seg-one.yaml"),
      `title: Zoom and select
output: one.mp4
storybook: ${SITE}
scenes:
  - title: Zoom and select
    url: chart.html
    steps:
      - { say: Scroll up on the chart to zoom in., do: wheel, target: "#chart", delta_y: -200, steps: 2 }
      - { say: Drag across the chart to select a range., do: drag, target: "#chart", from: { x: 0.2, y: 0.5 }, to: { x: 0.6, y: 0.5 } }
      - { do: highlight, target: "text=Dragged 20% to 60% in 20 moves" }
      - { say: Double-click to mark a point., do: dblclick, target: "#chart" }
      - { say: Reload the page. The zoom stays., do: reload }
      - { do: highlight, target: "text=Stored zoom 3" }
`,
    );
    writeFileSync(
      join(dir, "seg-two.yaml"),
      `scenes:
  - title: Next visit
    url: chart.html
    steps:
      - { say: A new page still has the zoom., do: highlight, target: "text=Stored zoom 3" }
  - title: Framed chart
    url: framed.html
    wait_for: ${frame.slice(0, -1)} >> internal:control=enter-frame >> #chart'
    steps:
      - { say: The chart in the frame takes a drag too., do: drag, frame: ${frame}, target: "#chart", from: { x: 0.1, y: 0.5 }, to: { x: 0.9, y: 0.5 } }
      - { do: highlight, frame: ${frame}, target: "text=Dragged 10% to 90% in 20 moves" }
`,
    );
    const script = join(dir, "walk.yaml");
    writeFileSync(
      script,
      `title: Chart walkthrough
output: out/walk.webm
viewport: { width: 800, height: 480 }
storybook: ${SITE}
persist_storage: true
subtitles: { burn: false }
scenes:
  - include: seg-one.yaml
  - include: seg-two.yaml
`,
    );
    const res = await run([script, "--no-voice"]);
    expect(res.out).toContain("WebM: libvpx-vp9 video");
    expect(res.code).toBe(0);

    const out = join(dir, "out");
    const info = streams(join(out, "walk.webm"));
    expect(info).toMatch(/Input #0, matroska,webm/);
    expect(info).toMatch(/Video: vp9/);
    expect(info).not.toMatch(/Audio:/);
    expect(info).not.toMatch(/Subtitle:/);
    expect(info).toMatch(/title\s*: Zoom and select/);
    expect(info).toMatch(/title\s*: Next visit/);
    expect(info).toMatch(/title\s*: Framed chart/);

    // One clock across both segments: every cue starts after the one before.
    const vtt = readFileSync(join(out, "walk.vtt"), "utf8");
    const starts = cueStarts(vtt);
    expect(starts).toHaveLength(6);
    expect(
      starts.every((t, i) => i === 0 || t > (starts[i - 1] as number)),
    ).toBe(true);
    const transcript = readFileSync(join(out, "walk.md"), "utf8");
    const headings = [
      ...transcript.matchAll(/^## (\d)\. (.+) \[0:(\d\d\.\d)\]$/gm),
    ];
    expect(headings.map((m) => `${m[1]} ${m[2]}`)).toEqual([
      "1 Zoom and select",
      "2 Next visit",
      "3 Framed chart",
    ]);
    const sceneTimes = headings.map((m) => Number(m[3]));
    expect(sceneTimes[1]).toBeGreaterThan(sceneTimes[0] as number);
    expect(sceneTimes[2]).toBeGreaterThan(sceneTimes[1] as number);
    expect(starts[4]).toBeGreaterThan(sceneTimes[1] as number);
    expect(starts[5]).toBeGreaterThan(sceneTimes[2] as number);

    const seconds = Number(/Duration: 00:00:(\d+\.\d+)/.exec(info)?.[1]);
    const played = await playInChromium(out, "walk.webm", "walk.vtt");
    expect(played.cues).toBe(6);
    expect(Math.abs(played.duration - seconds)).toBeLessThan(0.1);
  }, 300_000);

  test("without persist_storage each scene starts with empty storage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sbv-it-"));
    const script = join(dir, "fresh.yaml");
    writeFileSync(
      script,
      `title: Fresh
output: fresh.mp4
viewport: { width: 640, height: 360 }
storybook: ${SITE}
scenes:
  - url: chart.html
    steps: [{ do: wheel, target: "#chart", delta_y: -100 }, { do: highlight, target: "text=Zoom 2" }]
  - url: chart.html
    steps: [{ do: highlight, target: "text=Nothing stored" }]
`,
    );
    const res = await run([script, "--no-voice"]);
    expect(res.code).toBe(0);
    expect(streams(join(dir, "fresh.mp4"))).toMatch(/Video: h264/);
  }, 120_000);

  describe("with voice from a stand-in API", () => {
    let server: ReturnType<typeof Bun.serve>;
    const requests: { key: string | null; text: string; url: string }[] = [];
    let tone: Blob;

    beforeAll(() => {
      mark("beforeAll: making the tone");
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
      mark("beforeAll: tone made");
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

      mark("voice: first run");
      const first = await run([script, "--cache-dir", cache], env);
      mark("voice: first run done");
      expect(first.code).toBe(0);
      expect(first.out).toContain("3 clip(s) generated, 0 reused");
      expect(first.out).not.toContain(SECRET);
      expect(requests.length).toBe(3);
      expect(requests.every((r) => r.key === SECRET)).toBe(true);
      expect(requests[0]?.url).toContain(
        "/v1/text-to-speech/DODLEQrClDo8wCz460ld?output_format=mp3_44100_128",
      );

      const info = streams(join(dir, "out", "fixture-tour.mp4"));
      mark("voice: streams read");
      expect(info).toMatch(/Audio: aac/);
      expect(info).toMatch(/Subtitle: mov_text/);
      // Each 2.5 s clip sets its step to 2.9 s, so the video is longer than the silent one.
      const seconds = Number(/Duration: 00:00:(\d+\.\d+)/.exec(info)?.[1]);
      expect(seconds).toBeGreaterThan(10.5);

      mark("voice: second run (dry run)");
      const second = await run([script, "--cache-dir", cache, "--dry-run"], {
        ELEVENLABS_API_URL: server.url.origin,
      });
      expect(second.code).toBe(0);
      expect(second.out).toContain("Every voice clip is cached");

      mark("voice: third run");
      const third = await run([script, "--cache-dir", cache], {
        ELEVENLABS_API_URL: server.url.origin,
      });
      expect(third.code).toBe(0); // no key set: every clip is cached, so none is needed
      expect(third.out).toContain("0 clip(s) generated, 3 reused");
      expect(requests.length).toBe(3);
    }, 300_000);

    test("--format webm writes Opus voice", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sbv-it-"));
      const script = join(dir, "voiced.yaml");
      writeFileSync(
        script,
        `title: Voiced WebM
output: out/v.mp4
viewport: { width: 640, height: 360 }
storybook: ${SITE}
voice: { provider: elevenlabs, voice_id: DODLEQrClDo8wCz460ld }
scenes:
  - url: form.html
    steps: [{ say: Type the case number to find it. }]
`,
      );
      const res = await run(
        [script, "--format", "webm", "--cache-dir", join(dir, "cache")],
        { ELEVENLABS_API_KEY: SECRET, ELEVENLABS_API_URL: server.url.origin },
      );
      expect(res.code).toBe(0);
      const info = streams(join(dir, "out", "v.webm"));
      expect(info).toMatch(/Video: vp9/);
      expect(info).toMatch(/Audio: opus, 48000 Hz, stereo/);
    }, 120_000);

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
