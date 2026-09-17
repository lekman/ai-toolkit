import { expect, test } from "bun:test";

import { FIXTURE, loadPlugin } from "./load";

const { parseDashboard, locateInsertPoint, KanbanView, DEFAULT_SETTINGS, NO_CLIENT } = loadPlugin();

/* ----------------------------------------------------------------- moving */

/** What KanbanView.move does to the lines, without a DOM. */
function move(text: string, fileLine: number, column: string, client: string) {
  const lines = text.split("\n");
  const body = lines[fileLine].replace(/^>\s?/, "");
  lines.splice(fileLine, 1);
  const spot = locateInsertPoint(lines, column, client);
  if (!spot) return null;
  const block = [];
  if (spot.createGroup) {
    block.push(spot.prefix.trimEnd(), `${spot.prefix}#### **${client}**`, spot.prefix.trimEnd());
  }
  block.push(spot.prefix + body);
  lines.splice(spot.index, 0, ...block);
  return lines.join("\n");
}

const parsed = parseDashboard(FIXTURE);
const open = (column: string, client?: string) =>
  parsed.items.find(
    (i: { column: string; client: string; checked: boolean }) =>
      i.column === column && !i.checked && (!client || i.client === client),
  );

test("a card moves between columns and keeps every other item", () => {
  const item = open("today", "Acme");
  const after = parseDashboard(move(FIXTURE, item.fileLine, "tomorrow", "Acme"));
  expect(after.items).toHaveLength(parsed.items.length);
  expect(after.items.find((i: { text: string }) => i.text === item.text).column).toBe("tomorrow");
});

test("a card moves to another client in the same column", () => {
  const item = open("today", "Acme");
  const after = parseDashboard(move(FIXTURE, item.fileLine, "today", "Globex"));
  const moved = after.items.find((i: { text: string }) => i.text === item.text);
  expect(moved.client).toBe("Globex");
  expect(moved.column).toBe("today");
  expect(after.items).toHaveLength(parsed.items.length);
});

test("moving to a client with no group in that day creates the group", () => {
  const item = open("today", "Acme");
  const text = move(FIXTURE, item.fileLine, "today", "Initech");
  expect(text).toContain("#### **Initech**");
  expect(text.split("\n")).toHaveLength(FIXTURE.split("\n").length + 3);
});

test("a move into a callout gains the quote prefix, and out of one loses it", () => {
  const item = open("today", "Acme");
  expect(move(FIXTURE, item.fileLine, "tomorrow", "Acme")).toContain(`> ${item.raw.trim()}`);
  const inCallout = open("tomorrow", "Acme");
  const out = move(FIXTURE, inCallout.fileLine, "today", "Acme");
  expect(out).toContain("\n- [ ] Already planned for tomorrow");
});

test("the callouts survive a move that creates a group", () => {
  const item = open("today", "Acme");
  const text = move(FIXTURE, item.fileLine, "unscheduled", "Umbrella");
  expect(text).toContain("> [!note]- Tomorrow");
  expect(text).toContain("> [!note]- Future");
  expect(text).toContain("## Initiatives");
});

test("a move into a column with no day is refused rather than guessed at", () => {
  const noFuture = FIXTURE.replace(/> ### Friday 18 September[\s\S]*?(?=> ### Unscheduled)/, "");
  const item = parseDashboard(noFuture).items.find(
    (i: { column: string; checked: boolean }) => i.column === "today" && !i.checked,
  );
  expect(locateInsertPoint(noFuture.split("\n"), "future", "Acme")).toBeNull();
  expect(move(noFuture, item.fileLine, "future", "Acme")).toBeNull();
});

/* -------------------------------------------------------- client choices */

const choices = (clientOrder: string[] = []) =>
  KanbanView.prototype.clientChoices.call({ parsed, plugin: { settings: { clientOrder } } });

test("every client in the file is offered as a move target", () => {
  for (const name of ["Acme", "Globex", "Umbrella", "Initech"]) {
    expect(choices()).toContain(name);
  }
});

test("a configured client with no items is still offered", () => {
  expect(choices(["Brand New"])).toContain("Brand New");
});

test("the offer does not depend on the current view", () => {
  // Umbrella is Friday-only, so a card in today must still be able to reach it.
  expect(choices()).toContain("Umbrella");
});

test("no duplicates when a client is both configured and in the file", () => {
  const list = choices(["Acme", "Globex"]);
  expect(list).toHaveLength(new Set(list).size);
});

/* --------------------------------------------------------------- collapse */

test("collapsing a client records it, and collapsing again clears it", async () => {
  let saved = 0;
  let refreshed = 0;
  const view = {
    plugin: {
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: async () => {
        saved++;
      },
      refreshViews: () => {
        refreshed++;
      },
    },
  };
  const toggle = (c: string) => KanbanView.prototype.toggleClient.call(view, c);

  await toggle("Acme");
  expect(view.plugin.settings.collapsedClients).toEqual(["Acme"]);
  await toggle("Globex");
  expect(view.plugin.settings.collapsedClients).toEqual(["Acme", "Globex"]);
  await toggle("Acme");
  expect(view.plugin.settings.collapsedClients).toEqual(["Globex"]);
  expect(saved).toBe(3);
  expect(refreshed).toBe(3);
});

test("a collapsed client that is no longer in the file is harmless", () => {
  const cols = [{ key: "today" }];
  const rows = KanbanView.prototype.clientRows.call(
    { plugin: { settings: { clientOrder: [] } } },
    parsed.items.filter((i: { column: string }) => i.column === "today"),
    cols,
  );
  expect(rows).not.toContain("Ghost Client");
  expect(rows).toContain("Acme");
});

test("items with no client heading fall under the no-client row", () => {
  const orphaned = `# D\n\n## Focus\n\n### Monday 1 January\n\n- [ ] loose item\n\n## Initiatives\n`;
  const p = parseDashboard(orphaned);
  expect(p.items[0].client).toBe(NO_CLIENT);
});
