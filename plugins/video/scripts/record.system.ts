/**
 * Drive Chromium through each scene with Playwright and record it.
 *
 * Each scene gets its own browser context, so each scene is one raw video
 * file. The recorder notes when the page was ready, when each step and each
 * caption started and ended, and returns those times with the file.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright";

import type { RecordedScene } from "./assemble.ts";
import type { IMediaProbe } from "./interfaces.ts";
import type { Step, VideoScript } from "./script.ts";
import type { Cue } from "./subtitles.ts";
import type { TimingPlan } from "./timing.ts";

import { installOverlay, type OverlayApi } from "./overlay.ts";
import { planChunks, wrapLines } from "./subtitles.ts";
import { SCENE_LEAD_MS, SCENE_TAIL_MS, stepKey } from "./timing.ts";
import { sceneUrl } from "./urls.ts";

/** Time the cursor takes to travel to a target, in ms. */
const CURSOR_MS = 650;
/** How long an action waits for its target to appear, in ms. */
const ACTION_TIMEOUT_MS = 10_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Launch Chromium. Playwright's own build comes first; it honours
 * PLAYWRIGHT_BROWSERS_PATH. If that build is not installed, installed Google
 * Chrome is tried before giving up.
 */
export async function launchBrowser(headed: boolean): Promise<Browser> {
  try {
    return await chromium.launch({ headless: !headed });
  } catch (first) {
    const message = first instanceof Error ? first.message : String(first);
    if (!/Executable doesn't exist|browserType\.launch/i.test(message))
      throw first;
    try {
      return await chromium.launch({ channel: "chrome", headless: !headed });
    } catch {
      throw new Error(
        "Chromium for Playwright is not installed, and Google Chrome was not found.\n" +
          "Install it with: bunx playwright install chromium",
      );
    }
  }
}

/** Error that names the scene and step that failed. */
function stepError(
  scene: number,
  step: number,
  s: Step,
  error: unknown,
): Error {
  const reason =
    error instanceof Error ? error.message.split("\n")[0] : String(error);
  const what = s.target ? `${s.do} on ${s.target}` : (s.do ?? "say");
  return new Error(
    `Scene ${scene + 1}, step ${step + 1} (${what}) failed: ${reason}`,
  );
}

async function overlay(page: Page, captions: boolean): Promise<void> {
  await page.evaluate(installOverlay, { captions });
}

async function call<K extends keyof OverlayApi>(
  page: Page,
  name: K,
  ...args: Parameters<OverlayApi[K]>
): Promise<void> {
  await page.evaluate(
    ([n, a]) => {
      const api = (
        window as unknown as {
          __sbv: Record<string, (...x: unknown[]) => void>;
        }
      ).__sbv;
      api[n as string]?.(...(a as unknown[]));
    },
    [name, args] as const,
  );
}

/** Move the drawn cursor and the real mouse to the centre of a target. */
async function pointAt(
  page: Page,
  loc: Locator,
): Promise<{ box: { height: number; width: number; x: number; y: number } }> {
  await loc.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await loc.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS });
  const box = await loc.boundingBox();
  if (!box) throw new Error("the target has no size on screen");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await call(page, "move", x, y, CURSOR_MS);
  await sleep(CURSOR_MS + 50);
  return { box };
}

async function perform(page: Page, step: Step): Promise<void> {
  if (!step.do || step.do === "wait") return;
  const loc = step.target ? page.locator(step.target).first() : undefined;
  switch (step.do) {
    case "click": {
      await pointAt(page, loc as Locator);
      await call(page, "pulse");
      await (loc as Locator).click({ timeout: ACTION_TIMEOUT_MS });
      return;
    }
    case "highlight": {
      const { box } = await pointAt(page, loc as Locator);
      await call(page, "ring", box);
      return;
    }
    case "hover": {
      const { box } = await pointAt(page, loc as Locator);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
    case "press": {
      if (loc) {
        await pointAt(page, loc);
        await loc.focus({ timeout: ACTION_TIMEOUT_MS });
      }
      await page.keyboard.press(String(step.value));
      return;
    }
    case "scroll": {
      if (loc) {
        await loc.waitFor({ state: "attached", timeout: ACTION_TIMEOUT_MS });
        await loc.evaluate((el) =>
          el.scrollIntoView({ behavior: "smooth", block: "center" }),
        );
      } else {
        const by = Number(step.value ?? 400);
        await page.evaluate(
          (top) => window.scrollBy({ behavior: "smooth", top }),
          by,
        );
      }
      await sleep(700);
      return;
    }
    case "type": {
      await pointAt(page, loc as Locator);
      await call(page, "pulse");
      await (loc as Locator).click({ timeout: ACTION_TIMEOUT_MS });
      await (loc as Locator).fill("", { timeout: ACTION_TIMEOUT_MS });
      await (loc as Locator).pressSequentially(String(step.value), {
        delay: 55,
      });
      return;
    }
  }
}

/** Wait until Storybook has rendered the story into its root element. */
async function waitForStory(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const root = document.querySelector("#storybook-root, #root");
      return Boolean(root && root.children.length > 0);
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Record every scene. Returns one RecordedScene per scene, in order. */
export async function recordScenes(input: {
  baseUrl?: string;
  headed: boolean;
  log: (line: string) => void;
  plan: TimingPlan;
  probe: IMediaProbe;
  script: VideoScript;
  workDir: string;
}): Promise<RecordedScene[]> {
  const { plan, script } = input;
  const { height, width } = script.viewport;
  const maxLine = script.subtitles.max_line;
  const burn = script.subtitles.burn;
  const browser = await launchBrowser(input.headed);
  const recorded: RecordedScene[] = [];
  try {
    for (const [si, scene] of script.scenes.entries()) {
      const planned = plan.scenes[si];
      if (!planned) throw new Error(`No timing plan for scene ${si + 1}`);
      input.log(
        `Recording scene ${si + 1}/${script.scenes.length}: ${planned.label}`,
      );
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        recordVideo: {
          dir: join(input.workDir, `scene-${si + 1}`),
          size: { height, width },
        },
        reducedMotion: "no-preference",
        viewport: { height, width },
      });
      const t0 = performance.now();
      const page = await context.newPage();
      const captions: Cue[] = [];
      const steps: RecordedScene["steps"] = [];
      let tReady = 0;
      let tEnd = 0;
      try {
        const url = sceneUrl(scene, input.baseUrl);
        await page.goto(url, { timeout: 60_000, waitUntil: "load" });
        if (scene.story) await waitForStory(page);
        if (scene.wait_for) {
          await page
            .locator(scene.wait_for)
            .first()
            .waitFor({ state: "visible", timeout: 30_000 });
        }
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await overlay(page, burn);
        await page.mouse.move(width / 2, height / 2);
        tReady = performance.now();
        const now = (): number => performance.now() - tReady;

        await sleep(SCENE_LEAD_MS);
        let open: Cue | undefined;
        const show = async (text: string | null): Promise<void> => {
          const t = now();
          if (open) {
            open.endMs = t;
            captions.push(open);
            open = undefined;
          }
          if (text) open = { endMs: t, startMs: t, text };
          await call(
            page,
            "caption",
            text ? wrapLines(text, maxLine).join("\n") : null,
          );
        };

        for (const [pi, step] of scene.steps.entries()) {
          const target = planned.steps[pi];
          if (!target)
            throw new Error(
              `No timing plan for scene ${si + 1}, step ${pi + 1}`,
            );
          await overlay(page, burn); // a click may have replaced the document
          const start = now();
          const chunks = step.say
            ? planChunks(step.say, target.durationMs, maxLine)
            : [];
          await show(chunks[0]?.text ?? null);
          try {
            await perform(page, step);
          } catch (error) {
            throw stepError(si, pi, step, error);
          }
          for (const chunk of chunks.slice(1)) {
            await sleep(start + chunk.offsetMs - now());
            await show(chunk.text);
          }
          await sleep(start + target.durationMs - now());
          const end = now();
          const next = scene.steps[pi + 1];
          if (!next?.say) await show(null);
          if (step.do === "highlight") await call(page, "ring", null);
          steps.push({ endMs: end, key: stepKey(si, pi), startMs: start });
        }
        await show(null);
        await sleep(SCENE_TAIL_MS);
        tEnd = now();
      } finally {
        await page.close();
        await context.close();
      }
      const tClosed = performance.now();
      const video = page.video();
      const videoPath = video ? await video.path() : "";
      if (!videoPath || !existsSync(videoPath)) {
        throw new Error(`Playwright did not write a video for scene ${si + 1}`);
      }
      // The recording starts a little after newPage() is called. Its length
      // against the wall clock says by how much, so the cut lands on tReady.
      const videoMs = await input.probe.durationMs(videoPath);
      const startLag = Math.max(0, tClosed - t0 - videoMs);
      recorded.push({
        captions,
        durationMs: Math.round(tEnd),
        offsetMs: Math.max(0, Math.round(tReady - t0 - startLag)),
        steps,
        videoPath,
      });
    }
  } finally {
    await browser.close();
  }
  return recorded;
}
