/**
 * End to end, without recording: run the new actions against local pages in
 * Chromium and check what the page and the drawn cursor did.
 */

import type { Browser, BrowserContext, Page } from "playwright";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { launchBrowser, perform, Stage } from "../scripts/record.system.ts";
import { parseScript, type Scene } from "../scripts/script.ts";
import { serveFolder, type StaticServer } from "../scripts/serve.system.ts";

const SITE = join(import.meta.dir, "fixtures", "site");
const SIZE = { height: 480, width: 800 };

// Skip, rather than fail, on a machine with no browser for Playwright.
const browserReady = await launchBrowser(false)
  .then(async (b) => {
    await b.close();
    return true;
  })
  .catch(() => false);

/** Validate one scene through the real schema, so the test uses what a script would. */
function scene(url: string, steps: string): Scene {
  const script = parseScript(
    `title: T\noutput: o.mp4\nstorybook: http://127.0.0.1/\nscenes:\n  - url: ${url}\n    steps:\n${steps}`,
  );
  return script.scenes[0] as Scene;
}

/** The drawn cursor's position on the top page, from its style. */
async function cursorAt(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.getElementById("sbv-cursor") as HTMLElement;
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  });
}

describe.skipIf(!browserReady)("actions", () => {
  let browser: Browser;
  let server: StaticServer;
  let context: BrowserContext;

  beforeAll(async () => {
    browser = await launchBrowser(false);
    server = await serveFolder(SITE);
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function open(path: string): Promise<Stage> {
    context = await browser.newContext({ viewport: SIZE });
    const page = await context.newPage();
    await page.goto(new URL(path, server.url).toString());
    const stage = new Stage(page, { captions: true, size: SIZE });
    await stage.install();
    return stage;
  }

  async function run(stage: Stage, s: Scene): Promise<void> {
    for (const step of s.steps) await perform(stage, s, step);
  }

  test("drag sends real pointer events to an SVG and the cursor follows", async () => {
    const stage = await open("chart.html");
    const s = scene(
      "chart.html",
      "      - { do: drag, target: '#chart', from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, steps: 12 }\n",
    );
    const t0 = performance.now();
    await run(stage, s);
    const took = performance.now() - t0;
    const page = stage.page;
    await expect(page.locator("#drag").textContent()).resolves.toBe(
      "Dragged 20% to 80% in 12 moves",
    );
    const box = await page.locator("#chart").boundingBox();
    const at = await cursorAt(page);
    expect(at.x).toBeCloseTo((box?.x ?? 0) + 0.8 * 400, 3);
    expect(at.y).toBeCloseTo((box?.y ?? 0) + 0.5 * 200, 3);
    // Cursor travel, two holds and 12 moves of 40 ms.
    expect(took).toBeGreaterThan(650 + 2 * 120 + 12 * 40);
    await context.close();
  }, 30_000);

  test("wheel sends one event per step at the point, and dblclick fires", async () => {
    const stage = await open("chart.html");
    await run(
      stage,
      scene(
        "chart.html",
        [
          "      - { do: wheel, target: '#chart', at: { x: 0.25, y: 0.5 }, delta_y: -300, steps: 3 }",
          "      - { do: dblclick, target: '#chart', at: { x: 0.75, y: 0.5 } }",
          "",
        ].join("\n"),
      ),
    );
    const page = stage.page;
    await expect(page.locator("#zoom").textContent()).resolves.toBe("Zoom 4");
    await expect(page.locator("#clicks").textContent()).resolves.toBe(
      "Double-clicked at 75%",
    );
    await context.close();
  }, 30_000);

  test("reload keeps localStorage and puts the overlay and cursor back", async () => {
    const stage = await open("chart.html");
    const page = stage.page;
    await expect(page.locator("#stored").textContent()).resolves.toBe(
      "Nothing stored",
    );
    await run(
      stage,
      scene(
        "chart.html",
        "      - { do: wheel, target: '#chart', delta_y: -100 }\n",
      ),
    );
    await stage.show("A caption");
    const before = await cursorAt(page);
    await run(stage, scene("chart.html", "      - { do: reload }\n"));
    await expect(page.locator("#stored").textContent()).resolves.toBe(
      "Stored zoom 2",
    );
    expect(await cursorAt(page)).toEqual(before);
    const caption = await page.evaluate(
      () => document.getElementById("sbv-root")?.textContent ?? "",
    );
    expect(caption).toContain("A caption");
    await context.close();
  }, 30_000);

  test("a drag reaches a chart inside a sandboxed srcdoc iframe", async () => {
    const stage = await open("framed.html");
    const page = stage.page;
    await run(
      stage,
      scene(
        "framed.html",
        `      - { do: drag, frame: 'iframe[title="Chart"]', target: '#chart', from: { x: 0.1, y: 0.5 }, to: { x: 0.9, y: 0.5 } }\n`,
      ),
    );
    const frame = page.locator('iframe[title="Chart"]').contentFrame();
    await expect(frame.locator("#status").textContent()).resolves.toBe(
      "Dragged 10% to 90% in 20 moves",
    );
    // The cursor sits at the frame's offset on the top page plus the
    // chart's box inside the frame, measured here on each side separately.
    const frameBox = await page.locator('iframe[title="Chart"]').boundingBox();
    const inner = await frame
      .locator("#chart")
      .evaluate((el) => el.getBoundingClientRect().toJSON());
    const at = await cursorAt(page);
    expect(at.x).toBeCloseTo(
      (frameBox?.x ?? 0) + inner.left + 0.9 * inner.width,
      3,
    );
    expect(at.y).toBeCloseTo(
      (frameBox?.y ?? 0) + inner.top + 0.5 * inner.height,
      3,
    );
    await context.close();
  }, 30_000);

  test("Playwright's frame selector chain works as a target too", async () => {
    const stage = await open("framed.html");
    await run(
      stage,
      scene(
        "framed.html",
        `      - { do: highlight, target: 'iframe[title="Chart"] >> internal:control=enter-frame >> #status' }\n`,
      ),
    );
    const ring = await stage.page.evaluate(
      () =>
        (document.getElementById("sbv-root")?.firstElementChild as HTMLElement)
          .style.opacity,
    );
    expect(ring).toBe("1");
    await context.close();
  }, 30_000);
});
