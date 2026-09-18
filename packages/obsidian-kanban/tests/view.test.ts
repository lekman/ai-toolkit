import { expect, test } from "bun:test";

import { FIXTURE, loadPlugin } from "./load";

const {
  VIEWS,
  COLUMNS,
  viewColumns,
  normalizeView,
  DEFAULT_SETTINGS,
  parseDashboard,
  KanbanView,
} = loadPlugin();

const keys = (k?: string) => viewColumns(k).map((c: { key: string }) => c.key);

test("the default view is Today, with done hidden and nothing collapsed", () => {
  expect(DEFAULT_SETTINGS.view).toBe("today");
  expect(DEFAULT_SETTINGS.hideCompleted).toBe(true);
  expect(DEFAULT_SETTINGS.collapsedClients).toEqual([]);
});

test("each view selects its columns", () => {
  expect(keys("focus")).toEqual(["today", "tomorrow"]);
  expect(keys("today")).toEqual(["today"]);
  expect(keys("all")).toEqual(COLUMNS.map((c: { key: string }) => c.key));
});

test("a view key the build no longer knows falls back to the default", () => {
  expect(normalizeView("weekly")).toBe(DEFAULT_SETTINGS.view);
  expect(normalizeView(undefined)).toBe(DEFAULT_SETTINGS.view);
  expect(keys("weekly")).toEqual(keys(DEFAULT_SETTINGS.view));
});

test("the picker offers exactly Focus, Today and All", () => {
  expect(VIEWS.map((v: { label: string }) => v.label)).toEqual([
    "Focus",
    "Today",
    "All",
  ]);
});

const rows = (viewKey: string, clientOrder: string[] = []) => {
  const cols = viewColumns(viewKey);
  const parsed = parseDashboard(FIXTURE);
  const visible = parsed.items.filter((it: { column: string }) =>
    cols.some((c: { key: string }) => c.key === it.column),
  );
  return {
    clients: KanbanView.prototype.clientRows.call(
      { plugin: { settings: { clientOrder } } },
      visible,
      cols,
    ),
    count: visible.length,
  };
};

test("a client with no work in the view gets no row", () => {
  // Umbrella is Friday-only, so it appears in All and nowhere else.
  expect(rows("today").clients).not.toContain("Umbrella");
  expect(rows("focus").clients).not.toContain("Umbrella");
  expect(rows("all").clients).toContain("Umbrella");
});

test("narrowing the view never adds items", () => {
  expect(rows("today").count).toBeLessThanOrEqual(rows("focus").count);
  expect(rows("focus").count).toBeLessThanOrEqual(rows("all").count);
});

test("All covers every parsed item", () => {
  expect(rows("all").count).toBe(parseDashboard(FIXTURE).items.length);
});

test("configured clients lead the rows, the rest follow file order", () => {
  expect(rows("all", ["Initech", "Umbrella"]).clients.slice(0, 2)).toEqual([
    "Initech",
    "Umbrella",
  ]);
});

test("a configured client with no items in view is not given an empty row", () => {
  expect(rows("today", ["Umbrella"]).clients).not.toContain("Umbrella");
});

/* ------------------------------------------- the intention sits in the row head */

test("an intention callout is captured per client, per column", () => {
  const p = parseDashboard(FIXTURE);
  expect(p.intentions["today|Acme"]).toBe("three things and nothing else.");
  expect(p.intentions["today|Globex"]).toBeUndefined();
});

test("a nested intention inside Tomorrow is captured at its own depth", () => {
  const nested = FIXTURE.replace(
    "> #### **Acme**\n>\n> - [ ] Already planned for tomorrow",
    "> #### **Acme**\n>\n> > [!note] Intention: finish what Wednesday started.\n>\n> - [ ] Already planned for tomorrow",
  );
  const p = parseDashboard(nested);
  expect(p.intentions["tomorrow|Acme"]).toBe("finish what Wednesday started.");
});

test("continuation lines join the intention rather than starting an item", () => {
  const wrapped = FIXTURE.replace(
    "> [!note] Intention: three things and nothing else.",
    "> [!note] Intention: three things and nothing else.\n> The rest waits.",
  );
  const p = parseDashboard(wrapped);
  expect(p.intentions["today|Acme"]).toBe(
    "three things and nothing else. The rest waits.",
  );
  // The callout must not have swallowed the items below it.
  expect(p.items.filter((i: { client: string }) => i.client === "Acme").length)
    .toBeGreaterThan(0);
});

test("the row head shows the leftmost visible column's intention", () => {
  const p = parseDashboard(FIXTURE);
  const pick = (view: string, client: string) =>
    KanbanView.prototype.intentionFor.call(null, p, viewColumns(view), client);
  expect(pick("today", "Acme")).toBe("three things and nothing else.");
  expect(pick("focus", "Acme")).toBe("three things and nothing else.");
  expect(pick("all", "Globex")).toBe("");
});
