import { describe, expect, test } from "bun:test";

import { Dashboard } from "../src/dashboard/dashboard.ts";

const SAMPLE = `# Dashboard

## Focus

> [!note]- How to maintain this Focus log (for editors)

### Thursday 13 August

#### **Evinova**
> [!note] Intention: something.

- [ ] An Evinova task

#### **Lekman Consulting**
> [!note] Intention: something else.

- [x] A finished task
- [ ] An open task with a **bold** bit
    continued on the next line

### Friday 14 August

#### **Lekman Consulting**

- [ ] Tomorrow's task

### Unscheduled — no day assigned

#### **AlgoDx**

- [ ] Someday

## Initiatives

### AlgoDx
- [ ] This must never be parsed
`;

const TODAY = new Date(2026, 7, 13); // Thursday 13 August 2026

describe("parseDayHeading", () => {
  test("infers the year closest to today", () => {
    const date = Dashboard.parseDayHeading("Thursday 13 August", TODAY);
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(13);
  });

  test("crosses the year boundary towards the matching weekday", () => {
    const newYearsEve = new Date(2026, 11, 31);
    const date = Dashboard.parseDayHeading("Friday 1 January", newYearsEve);
    expect(date?.getFullYear()).toBe(2027);
  });

  test("works without a weekday", () => {
    expect(Dashboard.parseDayHeading("3 September", TODAY)?.getMonth()).toBe(8);
  });

  test("returns null for an undated heading", () => {
    expect(
      Dashboard.parseDayHeading("Unscheduled — no day assigned", TODAY),
    ).toBeNull();
  });

  test("rejects a day that does not exist in the month", () => {
    expect(Dashboard.parseDayHeading("31 February", TODAY)).toBeNull();
  });
});

describe("parse", () => {
  const days = Dashboard.parse(SAMPLE, TODAY);

  test("reads only the Focus section", () => {
    const all = days.flatMap((d) => d.groups.flatMap((g) => g.tasks));
    expect(all.some((t) => t.text.includes("never be parsed"))).toBe(false);
  });

  test("finds every day heading, dated and not", () => {
    expect(days.map((d) => d.heading)).toEqual([
      "Thursday 13 August",
      "Friday 14 August",
      "Unscheduled — no day assigned",
    ]);
    expect(days[2]?.date).toBeNull();
  });

  test("groups tasks under their client", () => {
    const day = Dashboard.dayOn(days, TODAY);
    expect(day?.groups.map((g) => g.client)).toEqual([
      "Evinova",
      "Lekman Consulting",
    ]);
  });

  test("reads the checkbox state", () => {
    const day = Dashboard.dayOn(days, TODAY);
    const lekman = day?.groups[1];
    expect(lekman?.tasks[0]?.done).toBe(true);
    expect(lekman?.tasks[1]?.done).toBe(false);
  });

  test("joins indented continuation lines into the task", () => {
    const day = Dashboard.dayOn(days, TODAY);
    expect(day?.groups[1]?.tasks[1]?.text).toBe(
      "An open task with a **bold** bit continued on the next line",
    );
  });

  test("does not absorb the next client's callout into a task", () => {
    const day = Dashboard.dayOn(days, TODAY);
    expect(day?.groups[0]?.tasks[0]?.text).toBe("An Evinova task");
  });
});

describe("dayOn", () => {
  const days = Dashboard.parse(SAMPLE, TODAY);

  test("finds tomorrow", () => {
    const tomorrow = new Date(2026, 7, 14);
    expect(Dashboard.dayOn(days, tomorrow)?.heading).toBe("Friday 14 August");
  });

  test("returns undefined for a day with no heading", () => {
    expect(Dashboard.dayOn(days, new Date(2026, 7, 20))).toBeUndefined();
  });

  test("ignores the time of day", () => {
    const afternoon = new Date(2026, 7, 13, 16, 30);
    expect(Dashboard.dayOn(days, afternoon)?.heading).toBe(
      "Thursday 13 August",
    );
  });
});

describe("filterGroups", () => {
  const days = Dashboard.parse(SAMPLE, TODAY);
  const day = Dashboard.dayOn(days, TODAY);

  test("keeps only the named clients", () => {
    const groups = Dashboard.filterGroups(day, ["Lekman Consulting"]);
    expect(groups.map((g) => g.client)).toEqual(["Lekman Consulting"]);
  });

  test("matches the client name case-insensitively", () => {
    expect(Dashboard.filterGroups(day, ["lekman consulting"])).toHaveLength(1);
  });

  test("an empty filter keeps every group", () => {
    expect(Dashboard.filterGroups(day, [])).toHaveLength(2);
  });

  test("an unknown client keeps nothing", () => {
    expect(Dashboard.filterGroups(day, ["Globex"])).toHaveLength(0);
  });

  test("an undefined day yields nothing", () => {
    expect(Dashboard.filterGroups(undefined, [])).toHaveLength(0);
  });
});
