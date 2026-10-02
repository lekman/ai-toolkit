/**
 * Points and paths for pointer gestures. Pure: the recorder turns these into
 * mouse events and cursor moves.
 *
 * A point in a script is a fraction of the target's box: `{ x: 0, y: 0 }` is
 * the top-left corner and `{ x: 1, y: 1 }` the bottom-right corner.
 */

/** A rectangle on screen, in CSS pixels from the top-left of the top page. */
export interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** A point on screen, in CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** The centre of a box, as a fraction. */
export const CENTRE: Point = { x: 0.5, y: 0.5 };

/** The screen point at a fraction of a box. */
export function pointInBox(box: Box, at: Point = CENTRE): Point {
  return { x: box.x + box.width * at.x, y: box.y + box.height * at.y };
}

/** Ease in and out, so a drag starts and ends slowly, as a hand does. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The points a drag passes through after the start point: `steps` points,
 * the last one exactly `to`.
 */
export function dragPath(from: Point, to: Point, steps: number): Point[] {
  const n = Math.max(1, Math.round(steps));
  const points: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i === n ? 1 : ease(i / n);
    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
  }
  return points;
}

/** Split a wheel movement into `steps` equal events that add up to `total`. */
export function wheelDeltas(total: number, steps: number): number[] {
  const n = Math.max(1, Math.round(steps));
  return Array.from({ length: n }, () => total / n);
}
