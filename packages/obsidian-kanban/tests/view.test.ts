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
  expect(
    p.items.filter((i: { client: string }) => i.client === "Acme").length,
  ).toBeGreaterThan(0);
});

test("the row head shows the leftmost visible column's intention", () => {
  const p = parseDashboard(FIXTURE);
  const pick = (view: string, client: string) =>
    KanbanView.prototype.intentionFor.call(null, p, viewColumns(view), client);
  expect(pick("today", "Acme")).toBe("three things and nothing else.");
  expect(pick("focus", "Acme")).toBe("three things and nothing else.");
  expect(pick("all", "Globex")).toBe("");
});

/* ------------------------------------------------- overlapping refreshes */

/** Enough of an Obsidian element for render() to build a whole board into. */
interface FakeEl {
  cls: string;
  tag: string;
  children: FakeEl[];
  empties: number;
  empty(): void;
  createDiv(o?: { cls?: string }): FakeEl;
  createSpan(o?: { cls?: string }): FakeEl;
  createEl(tag: string, o?: { cls?: string }): FakeEl;
  // render() also sets draggable, checked, value and the like.
  [key: string]: unknown;
}

function fakeEl(): FakeEl {
  const el = {
    cls: "",
    tag: "",
    children: [] as FakeEl[],
    empties: 0,
    style: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    empty() {
      el.empties++;
      el.children.length = 0;
    },
    addClass() {},
    removeClass() {},
    hasClass: () => false,
    toggleClass() {},
    setAttribute() {},
    addEventListener() {},
    createDiv: (o: { cls?: string } = {}) => make("div", o),
    createSpan: (o: { cls?: string } = {}) => make("span", o),
    createEl: (tag: string, o: { cls?: string } = {}) => make(tag, o),
  } as FakeEl;
  function make(tag: string, o: { cls?: string }): FakeEl {
    const child = fakeEl();
    child.tag = tag;
    child.cls = o.cls ?? "";
    el.children.push(child);
    return child;
  }
  return el;
}

interface FakeView {
  contentEl: FakeEl;
  expanded: Set<number>;
  renderGen: number;
  renderMd: () => void;
  plugin: { settings: Record<string, unknown> };
  app: {
    vault: {
      getAbstractFileByPath: () => object;
      read: () => Promise<string>;
    };
  };
  render: () => Promise<void>;
}

test("two overlapping refreshes draw the board once, not twice", async () => {
  const root = fakeEl();
  const reads: ((v: string) => void)[] = [];
  const view = Object.create(KanbanView.prototype) as FakeView;
  view.contentEl = root;
  view.expanded = new Set();
  view.renderGen = 0;
  view.renderMd = () => {};
  view.plugin = {
    settings: { ...DEFAULT_SETTINGS, dashboardPath: "Dashboard.md" },
  };
  view.app = {
    vault: {
      getAbstractFileByPath: () => ({}),
      read: () => new Promise<string>((res) => reads.push(res)),
    },
  };

  // A move asks for a refresh, and the vault's modify event asks for another.
  const first = view.render();
  const second = view.render();
  expect(reads).toHaveLength(2);
  reads[0](FIXTURE);
  reads[1](FIXTURE);
  await first;
  await second;

  // The overtaken render must not clear the DOM, nor append a second board.
  expect(root.empties).toBe(1);
  expect(root.children.filter((c) => c.cls === "dk-board")).toHaveLength(1);
  expect(root.children.filter((c) => c.cls === "dk-toolbar")).toHaveLength(1);
});
