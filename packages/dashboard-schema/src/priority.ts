/**
 * Priority is computed from three inputs (business value, effort and due date)
 * into a priority, an urgency and a Covey quadrant, with a one-line reason a
 * person can check. Until both business value and effort are set, the item's
 * stored priority (as imported, or set by hand) is used instead, as in Atlas.
 *
 * Two rules decide the result:
 *   1. Value against effort, from a lookup table: cheap valuable work first.
 *      Low value or below is low priority at any effort.
 *   2. Urgency from the due date raises priority one step, but only for work
 *      that matters (medium value or above). Urgent work of low value stays
 *      low; in Covey's terms it is to be minimised, not done first.
 */

import type {
  Assessment,
  BusinessValue,
  DashboardItem,
  Effort,
  IsoDate,
  Priority,
  Quadrant,
  Urgency,
} from "./types.ts";

/** The numeric value behind each business value level. */
export const BUSINESS_VALUE: Readonly<Record<BusinessValue, number>> = {
  negative: -1,
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  veryHigh: 4,
};

/** Value against effort. Rows below medium are low priority throughout. */
export const PRIORITY_MATRIX: Readonly<
  Record<BusinessValue, Readonly<Record<Effort, Priority>>>
> = {
  veryHigh: { XS: "high", S: "high", M: "high", L: "high", XL: "normal" },
  high: { XS: "high", S: "high", M: "high", L: "normal", XL: "normal" },
  medium: { XS: "high", S: "high", M: "normal", L: "normal", XL: "low" },
  low: { XS: "low", S: "low", M: "low", L: "low", XL: "low" },
  none: { XS: "low", S: "low", M: "low", L: "low", XL: "low" },
  negative: { XS: "low", S: "low", M: "low", L: "low", XL: "low" },
};

/** Due within this many working days (or overdue) is urgency `now`. */
export const NOW_WORKING_DAYS = 2;
/** Due within this many calendar days is urgency `soon`. */
export const SOON_DAYS = 7;

const PRIORITY_RANK: Readonly<Record<Priority, number>> = {
  high: 0,
  normal: 1,
  low: 2,
};
const URGENCY_RANK: Readonly<Record<Urgency, number>> = {
  now: 0,
  soon: 1,
  none: 2,
};
const RAISE: Readonly<Record<Priority, Priority>> = {
  low: "normal",
  normal: "high",
  high: "high",
};

const DAY_MS = 86_400_000;

/** Parse `YYYY-MM-DD` as midnight UTC, so the arithmetic ignores time zones. */
function utc(date: IsoDate): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`not a date: ${date}`);
  return ms;
}

/** Working days (Monday to Friday) after `from`, up to and including `to`. */
export function workingDaysBetween(from: IsoDate, to: IsoDate): number {
  let count = 0;
  for (let t = utc(from) + DAY_MS; t <= utc(to); t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

/** now when overdue or due within 2 working days, soon within 7 days, otherwise none. */
export function urgency(
  due: IsoDate | null | undefined,
  today: IsoDate,
): Urgency {
  if (!due) return "none";
  if (utc(due) <= utc(today)) return "now";
  if (workingDaysBetween(today, due) <= NOW_WORKING_DAYS) return "now";
  if ((utc(due) - utc(today)) / DAY_MS <= SOON_DAYS) return "soon";
  return "none";
}

function quadrant(important: boolean, urgent: boolean): Quadrant {
  if (important && urgent) return "Q1-do-now";
  if (important) return "Q2-schedule";
  if (urgent) return "Q3-minimise";
  return "Q4-drop";
}

const VALUE_LABEL: Readonly<Record<BusinessValue, string>> = {
  negative: "negative value",
  none: "no value",
  low: "low value",
  medium: "medium value",
  high: "high value",
  veryHigh: "very high value",
};

/** Priority, urgency and quadrant for one item, as of `today`. */
export function assess(
  item: Pick<DashboardItem, "businessValue" | "effort" | "due" | "priority">,
  today: IsoDate,
): Assessment {
  const u = urgency(item.due, today);
  if (!item.businessValue || !item.effort) {
    return {
      priority: item.priority,
      urgency: u,
      quadrant: "unsized",
      computed: false,
      reason: `unsized: stored priority ${item.priority} until business value and effort are set`,
    };
  }
  const base = PRIORITY_MATRIX[item.businessValue][item.effort];
  const important = BUSINESS_VALUE[item.businessValue] >= BUSINESS_VALUE.medium;
  const urgent = u !== "none";
  const priority = important && urgent ? RAISE[base] : base;

  const parts = [
    `${VALUE_LABEL[item.businessValue]}, ${item.effort} effort: ${base}`,
  ];
  if (priority !== base) parts.push(`raised to ${priority} by urgency ${u}`);
  else if (urgent && !important)
    parts.push(`urgency ${u} does not raise low-value work`);
  if (item.businessValue === "negative")
    parts.push("costs more than it returns, consider dropping");
  const q = quadrant(important, urgent);
  return {
    priority,
    urgency: u,
    quadrant: q,
    computed: true,
    reason: `${parts.join("; ")} (${q})`,
  };
}

/**
 * Atlas sizes value on a Fibonacci scale (1, 2, 3, 5, 8, 13). On import it
 * maps to the business value enum; Atlas has no negative value.
 */
export function businessValueFromAtlas(value: number): BusinessValue {
  if (value <= 2) return "low";
  if (value <= 3) return "medium";
  if (value <= 8) return "high";
  return "veryHigh";
}

/**
 * Order for a list: priority, then urgency, then due date (none last), then
 * the manual rank (none last), then creation time.
 */
export function compareItems(
  a: DashboardItem,
  b: DashboardItem,
  today: IsoDate,
): number {
  const x = assess(a, today);
  const y = assess(b, today);
  return (
    PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority] ||
    URGENCY_RANK[x.urgency] - URGENCY_RANK[y.urgency] ||
    compareOptional(a.due, b.due) ||
    compareOptional(a.rank, b.rank) ||
    a.createdAt.localeCompare(b.createdAt)
  );
}

function compareOptional(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  if (a) return -1;
  if (b) return 1;
  return 0;
}
