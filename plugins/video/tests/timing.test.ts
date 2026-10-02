import { describe, expect, test } from "bun:test";

import { parseScript } from "../scripts/script.ts";
import {
  actionMs,
  CURSOR_MS,
  DRAG_HOLD_MS,
  DRAG_STEP_MS,
  DRAG_STEPS,
  estimateSpeechMs,
  formatPlan,
  MIN_READ_MS,
  MIN_STEP_MS,
  planTiming,
  readingMs,
  RELOAD_MS,
  SCENE_LEAD_MS,
  SCENE_TAIL_MS,
  SETTLE_MS,
  stepDuration,
  stepKey,
  VOICE_GAP_MS,
  WHEEL_STEP_MS,
} from "../scripts/timing.ts";

describe("readingMs", () => {
  test("short text gets the minimum", () => {
    expect(readingMs("Hi.")).toBe(MIN_READ_MS);
  });
  test("long text scales at 15 characters per second", () => {
    expect(readingMs("x".repeat(60))).toBe(4000);
  });
});

describe("estimateSpeechMs", () => {
  test("counts words at 2.5 per second", () => {
    expect(estimateSpeechMs("one two three four five")).toBe(2000);
  });
});

describe("stepDuration", () => {
  test("voice wins when the clip is longest", () => {
    expect(stepDuration({ say: "Short.", voiceMs: 3000 })).toEqual({
      driver: "voice",
      durationMs: 3000 + VOICE_GAP_MS,
    });
  });
  test("reading wins when the caption needs longer than the clip", () => {
    const say = "x".repeat(90);
    expect(stepDuration({ say, voiceMs: 2000 })).toEqual({
      driver: "reading",
      durationMs: 6000,
    });
  });
  test("pause wins when it is longest", () => {
    expect(
      stepDuration({ pauseSeconds: 5, say: "Hi.", voiceMs: 1000 }),
    ).toEqual({
      driver: "pause",
      durationMs: 5000,
    });
  });
  test("a silent action gets the minimum", () => {
    expect(stepDuration({})).toEqual({
      driver: "minimum",
      durationMs: MIN_STEP_MS,
    });
  });
});

describe("planTiming", () => {
  const script = parseScript(`
title: T
output: o.mp4
storybook: ./sb
scenes:
  - story: a--b
    steps:
      - say: First line.
      - do: wait
        pause: 2
  - title: Second
    url: page.html
    steps:
      - say: Third line.
`);

  test("steps follow each other inside a scene after the lead-in", () => {
    const voice = new Map([[stepKey(0, 0), { estimated: false, ms: 3000 }]]);
    const plan = planTiming(script, voice);
    const [s1, s2] = plan.scenes;
    expect(s1?.steps[0]?.startMs).toBe(SCENE_LEAD_MS);
    expect(s1?.steps[0]?.durationMs).toBe(3400);
    expect(s1?.steps[1]?.startMs).toBe(SCENE_LEAD_MS + 3400);
    expect(s1?.durationMs).toBe(SCENE_LEAD_MS + 3400 + 2000 + SCENE_TAIL_MS);
    expect(s2?.startMs).toBe(s1?.durationMs);
    expect(s2?.label).toBe("Second");
    expect(plan.totalMs).toBe((s1?.durationMs ?? 0) + (s2?.durationMs ?? 0));
  });

  test("an intro moves every scene later by its length", () => {
    const withIntro = parseScript(
      `intro: { logo: logo.svg, duration: 2.5 }\n` +
        `title: T\noutput: o.mp4\nstorybook: ./sb\nscenes:\n  - story: a--b\n    steps: [{ say: Hi. }]\n`,
    );
    const plan = planTiming(withIntro);
    expect(plan.introMs).toBe(2500);
    expect(plan.scenes[0]?.startMs).toBe(2500);
    expect(plan.totalMs).toBe(2500 + (plan.scenes[0]?.durationMs ?? 0));
    expect(formatPlan(plan)).toStartWith(
      "Intro card  (starts 0:00.0, lasts 0:02.5)",
    );
  });

  test("no intro block means no intro time", () => {
    expect(planTiming(script).introMs).toBe(0);
  });

  test("the printed plan marks estimated voice lengths", () => {
    const voice = new Map([[stepKey(0, 0), { estimated: true, ms: 3000 }]]);
    const text = formatPlan(planTiming(script, voice));
    expect(text).toContain("voice~");
    expect(text).toContain("Scene 2: Second");
    expect(text).toMatch(/Total: \d:\d\d\.\d/);
  });
});

describe("action time", () => {
  const travel = CURSOR_MS + SETTLE_MS;

  test("a drag needs the cursor travel, two holds and its moves", () => {
    expect(actionMs({ do: "drag" })).toBe(
      travel + 2 * DRAG_HOLD_MS + DRAG_STEPS * DRAG_STEP_MS,
    );
    expect(actionMs({ do: "drag", steps: 50 })).toBe(
      travel + 2 * DRAG_HOLD_MS + 50 * DRAG_STEP_MS,
    );
  });

  test("a wheel needs the cursor travel and one gap per event", () => {
    expect(actionMs({ do: "wheel" })).toBe(travel + WHEEL_STEP_MS);
    expect(actionMs({ do: "wheel", steps: 4 })).toBe(
      travel + 4 * WHEEL_STEP_MS,
    );
  });

  test("a reload is planned at a fixed length; other actions add nothing", () => {
    expect(actionMs({ do: "reload" })).toBe(RELOAD_MS);
    expect(actionMs({ do: "click" })).toBe(0);
    expect(actionMs({})).toBe(0);
  });

  test("a long drag sets the step length when nothing else is longer", () => {
    const script = parseScript(`
title: T
output: o.mp4
scenes:
  - url: https://example.com/
    steps:
      - { say: Hi., do: drag, target: c, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, steps: 60 }
      - { say: Hi., do: wheel, target: c, delta_y: -100 }
`);
    const [drag, wheel] = planTiming(script).scenes[0]?.steps ?? [];
    expect(drag?.driver).toBe("action");
    expect(drag?.durationMs).toBe(
      travel + 2 * DRAG_HOLD_MS + 60 * DRAG_STEP_MS,
    );
    // One wheel event is shorter than the time to read the caption.
    expect(wheel?.driver).toBe("reading");
    expect(wheel?.durationMs).toBe(MIN_READ_MS);
  });
});
