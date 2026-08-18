import { describe, expect, test } from "bun:test";

import { Dashboard } from "../src/dashboard/dashboard.ts";

const SAMPLE = `# Dashboard

## Focus

> [!note]- How to maintain this Focus log (for editors)

### Thursday 13 August

#### **Globex**
> [!note] Intention: something.

- [ ] An Globex task

#### **Acme**
> [!note] Intention: something else.

- [x] A finished task
- [ ] An open task with a **bold** bit
    continued on the next line

### Friday 14 August

#### **Acme**

- [ ] Tomorrow's task

### Unscheduled — no day assigned

#### **Initech**

- [ ] Someday

## Initiatives

### Initech
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
    expect(day?.groups.map((g) => g.client)).toEqual(["Globex", "Acme"]);
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
    expect(day?.groups[0]?.tasks[0]?.text).toBe("An Globex task");
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
    const groups = Dashboard.filterGroups(day, ["Acme"]);
    expect(groups.map((g) => g.client)).toEqual(["Acme"]);
  });

  test("matches the client name case-insensitively", () => {
    expect(Dashboard.filterGroups(day, ["acme"])).toHaveLength(1);
  });

  test("an empty filter keeps every group", () => {
    expect(Dashboard.filterGroups(day, [])).toHaveLength(2);
  });

  test("an unknown client keeps nothing", () => {
    expect(Dashboard.filterGroups(day, ["Umbrella"])).toHaveLength(0);
  });

  test("an undefined day yields nothing", () => {
    expect(Dashboard.filterGroups(undefined, [])).toHaveLength(0);
  });

  test("drops completed tasks when they are hidden", () => {
    const groups = Dashboard.filterGroups(day, ["Acme"], false);
    expect(groups[0]?.tasks.map((t) => t.done)).toEqual([false]);
  });

  test("drops a group left empty once completed tasks are hidden", () => {
    const finished = Dashboard.parse(
      "## Focus\n### Thursday 13 August\n#### **Acme**\n\n- [x] all done\n",
      TODAY,
    );
    const onlyDone = Dashboard.dayOn(finished, TODAY);
    expect(Dashboard.filterGroups(onlyDone, [], true)).toHaveLength(1);
    expect(Dashboard.filterGroups(onlyDone, [], false)).toHaveLength(0);
  });

  test("does not mutate the parsed day, so the toggle is reversible", () => {
    Dashboard.filterGroups(day, [], false);
    expect(Dashboard.filterGroups(day, ["Acme"], true)[0]?.tasks).toHaveLength(
      2,
    );
  });
});

const FILE = [
  "## Focus",
  "### Monday 18 August",
  "#### **Acme**",
  "- [ ] open task",
  "- [x] done task",
  "  continuation line",
  "not a task",
].join("\n");

describe("Dashboard.toggle", () => {
  test("ticks an open task and leaves everything else byte-identical", () => {
    const out = Dashboard.toggle(FILE, 3, false);
    expect(out).not.toBeNull();
    const lines = (out ?? "").split("\n");
    expect(lines[3]).toBe("- [x] open task");
    expect(lines.filter((_, i) => i !== 3)).toEqual(
      FILE.split("\n").filter((_, i) => i !== 3),
    );
  });

  test("unticks a done task", () => {
    expect((Dashboard.toggle(FILE, 4, true) ?? "").split("\n")[4]).toBe(
      "- [ ] done task",
    );
  });

  test("refuses when the line is no longer in the state the pane showed", () => {
    // The pane rendered an open box; the file already says done. Someone else
    // ticked it in between, so the click is stale and writing would be a lie.
    expect(Dashboard.toggle(FILE, 4, false)).toBeNull();
  });

  test("refuses when the line is not a checkbox at all", () => {
    expect(Dashboard.toggle(FILE, 6, false)).toBeNull();
    expect(Dashboard.toggle(FILE, 2, false)).toBeNull();
  });

  test("refuses a line past the end of the file", () => {
    expect(Dashboard.toggle(FILE, 999, false)).toBeNull();
  });

  test("refuses a negative line rather than counting from the end", () => {
    expect(Dashboard.toggle(FILE, -1, false)).toBeNull();
  });

  test("keeps CRLF line endings intact", () => {
    // The vault syncs across machines, so the file may arrive with CRLF.
    // Rewriting every line ending would show up as a whole-file diff.
    const crlf = "- [ ] a\r\n- [ ] b\r\n";
    const out = Dashboard.toggle(crlf, 0, false) ?? "";
    expect(out).toBe("- [x] a\r\n- [ ] b\r\n");
  });

  test("preserves indentation and the bullet character", () => {
    const nested = "  * [ ] indented with a star";
    expect(Dashboard.toggle(nested, 0, false)).toBe("  * [x] indented with a star");
  });

  test("accepts an upper-case X as done", () => {
    expect(Dashboard.toggle("- [X] shouty", 0, true)).toBe("- [ ] shouty");
  });

  test("round-trips back to the original file", () => {
    const once = Dashboard.toggle(FILE, 3, false) ?? "";
    expect(Dashboard.toggle(once, 3, true)).toBe(FILE);
  });
});

describe("parsed tasks carry their source line", () => {
  test("line points at the checkbox that produced the task", () => {
    const days = Dashboard.parse(FILE, new Date("2026-08-18T12:00:00"));
    const tasks = days[0]?.groups[0]?.tasks ?? [];
    expect(tasks.map((t) => t.line)).toEqual([3, 4]);
    // And the line is usable: toggling by it hits the right row.
    expect((Dashboard.toggle(FILE, tasks[0]?.line ?? -1, false) ?? "").split("\n")[3]).toBe(
      "- [x] open task",
    );
  });
});
