import { expect, test } from "bun:test";

import { FIXTURE, loadPlugin } from "./load";

const { parseDashboard, itemTitle, itemBody, NO_CLIENT } = loadPlugin();

test("reads each band into its own column", () => {
  const p = parseDashboard(FIXTURE);
  expect(p.days.today).toEqual(["Wednesday 16 September"]);
  expect(p.days.tomorrow).toEqual(["Thursday 17 September"]);
  expect(p.days.future).toEqual(["Friday 18 September"]);
  expect(p.days.unscheduled).toEqual(["Unscheduled — no day assigned"]);
});

test("attributes items to the client group above them", () => {
  const p = parseDashboard(FIXTURE);
  const acme = p.items.filter((i: { client: string }) => i.client === "Acme");
  expect(acme).toHaveLength(4);
  expect(p.items.filter((i: { client: string }) => i.client === "Globex")).toHaveLength(1);
});

test("an intention callout is prose, not an item", () => {
  const p = parseDashboard(FIXTURE);
  expect(p.items.every((i: { text: string }) => !i.text.includes("Intention"))).toBe(true);
});

test("records the ticked state", () => {
  const p = parseDashboard(FIXTURE);
  expect(p.items.filter((i: { checked: boolean }) => i.checked)).toHaveLength(1);
});

test("strips exactly one quote level inside a callout", () => {
  const p = parseDashboard(FIXTURE);
  const item = p.items.find((i: { text: string }) => i.text.includes("Already planned"));
  expect(item.column).toBe("tomorrow");
  expect(item.depth).toBe(1);
  expect(item.text.startsWith(">")).toBe(false);
});

test("an item with no client heading above it is not attributed to one", () => {
  const orphan = FIXTURE.replace("#### **Globex**\n\n", "");
  const p = parseDashboard(orphan);
  expect(p.items.some((i: { client: string }) => i.client === NO_CLIENT)).toBe(false);
  // It belongs to the group it now sits under, not to a new one.
  expect(p.items.find((i: { text: string }) => i.text.includes("Globex open thing")).client).toBe("Acme");
});

test("takes the title from the bold run and the body from the rest", () => {
  expect(itemTitle("**First open thing** · with a body")).toBe("First open thing");
  expect(itemBody("**First open thing** · with a body")).toBe("with a body");
});

test("falls back to the plain text when there is no bold run", () => {
  expect(itemTitle("🧾 Admin thing")).toBe("🧾 Admin thing");
  expect(itemBody("🧾 Admin thing")).toBe("");
});

test("stops at the end of Focus", () => {
  const p = parseDashboard(FIXTURE);
  expect(p.items.every((i: { text: string }) => !i.text.includes("Untouched"))).toBe(true);
});
