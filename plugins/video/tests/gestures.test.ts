import { describe, expect, test } from "bun:test";

import { dragPath, pointInBox, wheelDeltas } from "../scripts/gestures.ts";

describe("pointInBox", () => {
  const box = { height: 200, width: 400, x: 120, y: 70 };

  test("defaults to the centre", () => {
    expect(pointInBox(box)).toEqual({ x: 320, y: 170 });
  });

  test("maps fractions onto the box", () => {
    expect(pointInBox(box, { x: 0, y: 0 })).toEqual({ x: 120, y: 70 });
    expect(pointInBox(box, { x: 0.25, y: 1 })).toEqual({ x: 220, y: 270 });
  });
});

describe("dragPath", () => {
  const from = { x: 100, y: 50 };
  const to = { x: 300, y: 150 };

  test("has one point per step and ends exactly at the end point", () => {
    const path = dragPath(from, to, 10);
    expect(path).toHaveLength(10);
    expect(path.at(-1)).toEqual(to);
  });

  test("moves forward every step, slowly at both ends", () => {
    const xs = [from.x, ...dragPath(from, to, 10).map((p) => p.x)];
    const gaps = xs.slice(1).map((x, i) => x - (xs[i] as number));
    expect(gaps.every((g) => g > 0)).toBe(true);
    expect(gaps[0]).toBeLessThan(gaps[5] as number);
    expect(gaps[9]).toBeLessThan(gaps[5] as number);
  });

  test("one step goes straight to the end", () => {
    expect(dragPath(from, to, 1)).toEqual([to]);
  });
});

describe("wheelDeltas", () => {
  test("splits the total evenly", () => {
    expect(wheelDeltas(-300, 3)).toEqual([-100, -100, -100]);
    expect(wheelDeltas(240, 1)).toEqual([240]);
  });
});
