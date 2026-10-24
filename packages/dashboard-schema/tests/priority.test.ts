import { describe, expect, test } from "bun:test";

import type { DashboardItem } from "../src/types.ts";

import {
  assess,
  businessValueFromAtlas,
  compareItems,
  PRIORITY_MATRIX,
  urgency,
  workingDaysBetween,
} from "../src/priority.ts";

// A Friday, so weekend handling is exercised.
const FRIDAY = "2026-10-23";

function item(over: Partial<DashboardItem>): DashboardItem {
  return {
    id: "01jb8z3k7q2m4v6w8x0y1z2a3b",
    classification: "internal",
    boundary: "acme",
    clientId: "acme",
    title: "Work",
    state: "todo",
    priority: "normal",
    businessValue: "medium",
    effort: "M",
    revision: 1,
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    ...over,
  };
}

describe("matrix", () => {
  test("medium value at very low effort is high priority", () => {
    expect(
      assess({ businessValue: "medium", effort: "XS", priority: "low" }, FRIDAY)
        .priority,
    ).toBe("high");
  });

  test("low value or below is low priority at every effort", () => {
    for (const value of ["low", "none", "negative"] as const) {
      for (const effort of ["XS", "S", "M", "L", "XL"] as const) {
        expect(PRIORITY_MATRIX[value][effort]).toBe("low");
      }
    }
  });

  test("high value at extra large effort is normal, not high", () => {
    expect(
      assess({ businessValue: "high", effort: "XL", priority: "high" }, FRIDAY)
        .priority,
    ).toBe("normal");
  });
});

describe("urgency", () => {
  test("counts working days, skipping the weekend", () => {
    // Friday to Tuesday: Monday and Tuesday.
    expect(workingDaysBetween(FRIDAY, "2026-10-27")).toBe(2);
  });

  test("overdue and due within two working days are now", () => {
    expect(urgency("2026-10-20", FRIDAY)).toBe("now");
    expect(urgency(FRIDAY, FRIDAY)).toBe("now");
    expect(urgency("2026-10-27", FRIDAY)).toBe("now");
  });

  test("within seven days is soon, later or none is none", () => {
    expect(urgency("2026-10-28", FRIDAY)).toBe("soon");
    expect(urgency("2026-10-30", FRIDAY)).toBe("soon");
    expect(urgency("2026-11-06", FRIDAY)).toBe("none");
    expect(urgency(undefined, FRIDAY)).toBe("none");
  });
});

describe("assess", () => {
  test("urgency raises important work one step", () => {
    const a = assess(
      {
        businessValue: "medium",
        effort: "L",
        due: "2026-10-26",
        priority: "low",
      },
      FRIDAY,
    );
    expect(a.priority).toBe("high");
    expect(a.quadrant).toBe("Q1-do-now");
    expect(a.reason).toContain("raised to high");
  });

  test("urgency never raises low-value work", () => {
    const a = assess(
      {
        businessValue: "low",
        effort: "XS",
        due: "2026-10-20",
        priority: "high",
      },
      FRIDAY,
    );
    expect(a.priority).toBe("low");
    expect(a.quadrant).toBe("Q3-minimise");
    expect(a.reason).toContain("does not raise");
  });

  test("important work with no deadline is Q2, the first-things-first quadrant", () => {
    expect(
      assess({ businessValue: "high", effort: "M", priority: "normal" }, FRIDAY)
        .quadrant,
    ).toBe("Q2-schedule");
  });

  test("negative value suggests dropping", () => {
    const a = assess(
      { businessValue: "negative", effort: "S", priority: "normal" },
      FRIDAY,
    );
    expect(a.quadrant).toBe("Q4-drop");
    expect(a.reason).toContain("consider dropping");
  });
});

describe("unsized items", () => {
  test("use the stored priority until value and effort are both set", () => {
    const a = assess(
      { effort: "XS", priority: "high", due: "2026-10-20" },
      FRIDAY,
    );
    expect(a).toMatchObject({
      priority: "high",
      quadrant: "unsized",
      computed: false,
      urgency: "now",
    });
  });

  test("Atlas Fibonacci values map onto the business value enum", () => {
    expect([1, 2, 3, 5, 8, 13].map(businessValueFromAtlas)).toEqual([
      "low",
      "low",
      "medium",
      "high",
      "high",
      "veryHigh",
    ]);
  });
});

describe("compareItems", () => {
  test("orders by priority, then urgency, then due date, then rank", () => {
    const items = [
      item({ id: "low", businessValue: "low", effort: "XS" }),
      item({ id: "normal-ranked-b", rank: "b" }),
      item({ id: "normal-ranked-a", rank: "a" }),
      item({ id: "high-soon", businessValue: "high", due: "2026-10-30" }),
      item({ id: "high-later", businessValue: "high", due: "2026-12-01" }),
    ];
    const order = items
      .sort((a, b) => compareItems(a, b, FRIDAY))
      .map((i) => i.id);
    expect(order).toEqual([
      "high-soon",
      "high-later",
      "normal-ranked-a",
      "normal-ranked-b",
      "low",
    ]);
  });
});
