/**
 * Load a video in Chromium's <video> element with its WebVTT file as a
 * track, and print its length and the track's cue count as JSON once it can
 * play. Runs as its own process: Chromium inside the `bun test` process,
 * next to CLI subprocesses, made the test process miss a child's exit on
 * Linux CI.
 *
 * Usage: bun play-video.ts <dir> <video file> <vtt file>
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchBrowser } from "../../scripts/record.system.ts";
import { serveFolder } from "../../scripts/serve.system.ts";

const [dir, video, vtt] = process.argv.slice(2) as [string, string, string];
writeFileSync(
  join(dir, "play.html"),
  `<!doctype html><video src="${video}" preload="auto" muted><track kind="subtitles" srclang="en" src="${vtt}" default></video>`,
);
const server = await serveFolder(dir);
const browser = await launchBrowser(false);
try {
  const page = await browser.newPage();
  await page.goto(`${server.url}play.html`);
  const result = await page.evaluate(
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
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await server.close();
}
