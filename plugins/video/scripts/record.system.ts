/**
 * Drive Chromium through each scene with Playwright and record it.
 *
 * Each scene opens its own page, so each scene is one raw video file. By
 * default each scene also gets its own browser context; with
 * `persist_storage` every scene shares one, so local storage and cookies
 * carry from scene to scene. The recorder notes when the page was ready,
 * when each step and each caption started and ended, and returns those
 * times with the file.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
} from "playwright";

import type { RecordedScene } from "./assemble.ts";
import type { IMediaProbe } from "./interfaces.ts";
import type { Scene, Step, VideoScript } from "./script.ts";
import type { Cue } from "./subtitles.ts";

import {
  type Box,
  dragPath,
  type Point,
  pointInBox,
  wheelDeltas,
} from "./gestures.ts";
import { installOverlay, type OverlayApi } from "./overlay.ts";
import { planChunks, wrapLines } from "./subtitles.ts";
import {
  CURSOR_MS,
  DRAG_HOLD_MS,
  DRAG_STEP_MS,
  DRAG_STEPS,
  SCENE_LEAD_MS,
  SCENE_TAIL_MS,
  SETTLE_MS,
  stepKey,
  type TimingPlan,
  WHEEL_STEP_MS,
} from "./timing.ts";
import { sceneUrl } from "./urls.ts";

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
  const where = s.frame ? `${s.target} in ${s.frame}` : s.target;
  const what = where ? `${s.do} on ${where}` : (s.do ?? "say");
  return new Error(
    `Scene ${scene + 1}, step ${step + 1} (${what}) failed: ${reason}`,
  );
}

/**
 * The overlay on one page, with the cursor position and caption it shows.
 * Both are kept here, so they come back when a reload or a navigation
 * replaces the document.
 */
export class Stage {
  /** The caption on screen, already wrapped into lines. */
  caption: null | string = null;
  /** The page being recorded. */
  readonly page: Page;
  /** Cursor position on the top page, from the left, in CSS pixels. */
  x: number;
  /** Cursor position on the top page, from the top, in CSS pixels. */
  y: number;
  readonly #captions: boolean;

  constructor(
    page: Page,
    opts: { captions: boolean; size: { height: number; width: number } },
  ) {
    this.page = page;
    this.#captions = opts.captions;
    this.x = opts.size.width / 2;
    this.y = opts.size.height / 2;
  }

  async #call<K extends keyof OverlayApi>(
    name: K,
    ...args: Parameters<OverlayApi[K]>
  ): Promise<void> {
    await this.page.evaluate(
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

  /** Show a caption, or hide it with null. */
  async show(text: null | string): Promise<void> {
    this.caption = text;
    await this.#call("caption", text);
  }

  /**
   * Install the overlay if the page has none. When it is new, put the
   * cursor and the caption back where they were.
   */
  async install(): Promise<void> {
    const fresh = await this.page.evaluate(installOverlay, {
      captions: this.#captions,
    });
    if (!fresh) return;
    await this.#call("move", this.x, this.y, 0);
    if (this.caption) await this.#call("caption", this.caption);
  }

  /** Move the drawn cursor. The real mouse does not move. */
  async move(to: Point, ms: number, linear = false): Promise<void> {
    this.x = to.x;
    this.y = to.y;
    await this.#call("move", to.x, to.y, ms, linear);
  }

  /** Draw a ripple under the cursor, as for a click. */
  async pulse(): Promise<void> {
    await this.#call("pulse");
  }

  /** Draw the highlight ring around a box, or hide it with null. */
  async ring(box: Box | null): Promise<void> {
    await this.#call("ring", box);
  }
}

/**
 * The element a step acts on. With `frame`, the target is looked for inside
 * the first iframe that matches it; without, on the page itself.
 */
function locate(page: Page, step: Step): Locator | undefined {
  if (!step.target) return undefined;
  const root = step.frame
    ? page.locator(step.frame).first().contentFrame()
    : page;
  return root.locator(step.target).first();
}

/**
 * Move the drawn cursor to a point in a target: its centre, or `at` as
 * fractions of its box. Returns the box and the point, both on the top page.
 * Playwright gives the box of an element in an iframe on the top page too,
 * so the cursor lands on it.
 */
async function pointAt(
  stage: Stage,
  loc: Locator,
  at?: Point,
): Promise<{ box: Box; point: Point }> {
  await loc.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  await loc.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS });
  const box = await loc.boundingBox();
  if (!box) throw new Error("the target has no size on screen");
  const point = pointInBox(box, at);
  await stage.move(point, CURSOR_MS);
  await sleep(CURSOR_MS + SETTLE_MS);
  return { box, point };
}

/** `at` as a position relative to the target's top-left corner, for Playwright. */
function position(box: Box, at?: Point): Point | undefined {
  return at ? { x: box.width * at.x, y: box.height * at.y } : undefined;
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

/** Wait until a scene's page is ready to record: the story, `wait_for`, and fonts. */
async function waitForScene(page: Page, scene: Scene): Promise<void> {
  if (scene.story) await waitForStory(page);
  if (scene.wait_for) {
    await page
      .locator(scene.wait_for)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

/**
 * Press, move and release the real mouse from one point in the target to
 * another, so pointerdown, pointermove and pointerup fire on the page. The
 * drawn cursor follows each move.
 */
async function drag(stage: Stage, loc: Locator, step: Step): Promise<void> {
  const { box, point: start } = await pointAt(stage, loc, step.from);
  const end = pointInBox(box, step.to);
  const mouse = stage.page.mouse;
  await mouse.move(start.x, start.y);
  await mouse.down();
  await stage.pulse();
  await sleep(DRAG_HOLD_MS);
  const t0 = performance.now();
  for (const [i, p] of dragPath(
    start,
    end,
    step.steps ?? DRAG_STEPS,
  ).entries()) {
    await mouse.move(p.x, p.y);
    await stage.move(p, DRAG_STEP_MS, true);
    await sleep(t0 + (i + 1) * DRAG_STEP_MS - performance.now());
  }
  await sleep(DRAG_HOLD_MS);
  await mouse.up();
}

/** Run one step's action on the page. */
export async function perform(
  stage: Stage,
  scene: Scene,
  step: Step,
): Promise<void> {
  if (!step.do || step.do === "wait") return;
  const page = stage.page;
  const loc = locate(page, step);
  switch (step.do) {
    case "click":
    case "dblclick": {
      const { box } = await pointAt(stage, loc as Locator, step.at);
      await stage.pulse();
      const options = {
        position: position(box, step.at),
        timeout: ACTION_TIMEOUT_MS,
      };
      if (step.do === "click") await (loc as Locator).click(options);
      else await (loc as Locator).dblclick(options);
      return;
    }
    case "drag": {
      await drag(stage, loc as Locator, step);
      return;
    }
    case "highlight": {
      const { box } = await pointAt(stage, loc as Locator);
      await stage.ring(box);
      return;
    }
    case "hover": {
      const { point } = await pointAt(stage, loc as Locator, step.at);
      await page.mouse.move(point.x, point.y);
      return;
    }
    case "press": {
      if (loc) {
        await pointAt(stage, loc);
        await loc.focus({ timeout: ACTION_TIMEOUT_MS });
      }
      await page.keyboard.press(String(step.value));
      return;
    }
    case "reload": {
      await page.reload({ timeout: 60_000, waitUntil: "load" });
      await waitForScene(page, scene);
      await stage.install();
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
      await pointAt(stage, loc as Locator);
      await stage.pulse();
      await (loc as Locator).click({ timeout: ACTION_TIMEOUT_MS });
      await (loc as Locator).fill("", { timeout: ACTION_TIMEOUT_MS });
      await (loc as Locator).pressSequentially(String(step.value), {
        delay: 55,
      });
      return;
    }
    case "wheel": {
      const { point } = await pointAt(stage, loc as Locator, step.at);
      await page.mouse.move(point.x, point.y);
      for (const dy of wheelDeltas(step.delta_y ?? 0, step.steps ?? 1)) {
        await page.mouse.wheel(0, dy);
        await sleep(WHEEL_STEP_MS);
      }
      return;
    }
  }
}

/**
 * Where the usable part of a closed page's recording starts. The recording
 * starts a little after newPage() is called; its length against the wall
 * clock says by how much, so the cut lands on tReady.
 */
async function cutPoint(
  page: Page,
  times: { t0: number; tClosed: number; tReady: number },
  probe: IMediaProbe,
  name: string,
): Promise<{ offsetMs: number; videoPath: string }> {
  const video = page.video();
  const videoPath = video ? await video.path() : "";
  if (!videoPath || !existsSync(videoPath)) {
    throw new Error(`Playwright did not write a video for ${name}`);
  }
  const videoMs = await probe.durationMs(videoPath);
  const startLag = Math.max(0, times.tClosed - times.t0 - videoMs);
  return {
    offsetMs: Math.max(0, Math.round(times.tReady - times.t0 - startLag)),
    videoPath,
  };
}

/** Record the intro card: load the page, start its fade, hold for its length. */
async function recordIntro(
  browser: Browser,
  input: {
    durationMs: number;
    html: string;
    probe: IMediaProbe;
    size: { height: number; width: number };
    title: string;
    workDir: string;
  },
): Promise<RecordedScene> {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    recordVideo: { dir: join(input.workDir, "intro"), size: input.size },
    viewport: input.size,
  });
  const t0 = performance.now();
  const page = await context.newPage();
  let tReady: number;
  try {
    await page.setContent(input.html, { timeout: 30_000, waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const img = document.querySelector("img");
      if (img) await img.decode().catch(() => undefined);
    });
    await page.evaluate(() => document.body.classList.add("go"));
    tReady = performance.now();
    await sleep(input.durationMs);
  } finally {
    await page.close();
    await context.close();
  }
  const cut = await cutPoint(
    page,
    { t0, tClosed: performance.now(), tReady },
    input.probe,
    "the intro",
  );
  return {
    captions: [],
    durationMs: input.durationMs,
    label: input.title,
    steps: [],
    ...cut,
  };
}

/**
 * Record the intro card, when there is one, and every scene. Returns one
 * RecordedScene each, in order, the intro first.
 */
export async function recordScenes(input: {
  baseUrl?: string;
  headed: boolean;
  /** The intro card page, when the script has an intro. */
  introHtml?: string;
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
  let shared: BrowserContext | undefined;
  try {
    if (input.introHtml && plan.introMs > 0) {
      input.log("Recording the intro card");
      recorded.push(
        await recordIntro(browser, {
          durationMs: plan.introMs,
          html: input.introHtml,
          probe: input.probe,
          size: { height, width },
          title: script.title,
          workDir: input.workDir,
        }),
      );
    }
    const newContext = (dir: string): Promise<BrowserContext> =>
      browser.newContext({
        deviceScaleFactor: 1,
        recordVideo: {
          dir: join(input.workDir, dir),
          size: { height, width },
        },
        reducedMotion: "no-preference",
        viewport: { height, width },
      });
    // One context for every scene keeps local storage and cookies between
    // them. Each scene still has its own page, and so its own recording.
    shared = script.persist_storage ? await newContext("scenes") : undefined;
    for (const [si, scene] of script.scenes.entries()) {
      const planned = plan.scenes[si];
      if (!planned) throw new Error(`No timing plan for scene ${si + 1}`);
      input.log(
        `Recording scene ${si + 1}/${script.scenes.length}: ${planned.label}`,
      );
      const context = shared ?? (await newContext(`scene-${si + 1}`));
      const t0 = performance.now();
      const page = await context.newPage();
      const stage = new Stage(page, {
        captions: burn,
        size: { height, width },
      });
      const captions: Cue[] = [];
      const steps: RecordedScene["steps"] = [];
      let tReady = 0;
      let tEnd = 0;
      try {
        const url = sceneUrl(scene, input.baseUrl);
        await page.goto(url, { timeout: 60_000, waitUntil: "load" });
        await waitForScene(page, scene);
        await stage.install();
        await page.mouse.move(width / 2, height / 2);
        tReady = performance.now();
        const now = (): number => performance.now() - tReady;

        await sleep(SCENE_LEAD_MS);
        let open: Cue | undefined;
        const show = async (text: null | string): Promise<void> => {
          const t = now();
          if (open) {
            open.endMs = t;
            captions.push(open);
            open = undefined;
          }
          if (text) open = { endMs: t, startMs: t, text };
          await stage.show(text ? wrapLines(text, maxLine).join("\n") : null);
        };

        for (const [pi, step] of scene.steps.entries()) {
          const target = planned.steps[pi];
          if (!target)
            throw new Error(
              `No timing plan for scene ${si + 1}, step ${pi + 1}`,
            );
          await stage.install(); // a click may have replaced the document
          const start = now();
          const chunks = step.say
            ? planChunks(step.say, target.durationMs, maxLine)
            : [];
          await show(chunks[0]?.text ?? null);
          try {
            await perform(stage, scene, step);
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
          if (step.do === "highlight") await stage.ring(null);
          steps.push({ endMs: end, key: stepKey(si, pi), startMs: start });
        }
        await show(null);
        await sleep(SCENE_TAIL_MS);
        tEnd = now();
      } finally {
        await page.close();
        if (!shared) await context.close();
      }
      const cut = await cutPoint(
        page,
        { t0, tClosed: performance.now(), tReady },
        input.probe,
        `scene ${si + 1}`,
      );
      recorded.push({
        captions,
        durationMs: Math.round(tEnd),
        label: planned.label,
        steps,
        ...cut,
      });
    }
  } finally {
    await shared?.close();
    await browser.close();
  }
  return recorded;
}
