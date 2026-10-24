import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Db } from "../src/db/store.ts";
import type { DashboardItem } from "../src/types.ts";

import * as schema from "../src/db/schema.ts";
import {
  appendLog,
  ClaimConflict,
  claimItem,
  getItem,
  insertItem,
  ItemNotFound,
  listItems,
  releaseItem,
  RevisionConflict,
  searchItems,
  updateItem,
} from "../src/db/store.ts";

const root = join(import.meta.dir, "..");

function example(name: string): DashboardItem {
  return JSON.parse(readFileSync(join(root, "examples", name), "utf8"));
}

/** The read shape drops empty arrays, so compare against the same. */
function normalised(item: DashboardItem): DashboardItem {
  const copy = { ...item };
  for (const k of ["tags", "log", "history"] as const) {
    if (Array.isArray(copy[k]) && copy[k]!.length === 0) delete copy[k];
  }
  return copy;
}

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(drizzle(pg), { migrationsFolder: join(root, "migrations") });
  for (const id of ["acme", "globex"]) {
    await db
      .insert(schema.client)
      .values({ id, classification: "internal", boundary: id, name: id });
  }
  await db.insert(schema.workstream).values([
    {
      id: "time-reporting",
      classification: "internal",
      boundary: "acme",
      clientId: "acme",
      title: "Time reporting",
    },
    {
      id: "estate-hygiene",
      classification: "internal",
      boundary: "globex",
      clientId: "globex",
      title: "Estate hygiene",
    },
  ]);
});

describe("round trip", () => {
  for (const name of [
    "blocked-integration.json",
    "quick-win.json",
    "low-value-urgent.json",
    "atlas-import.json",
  ]) {
    test(`${name} reads back as written`, async () => {
      const item = example(name);
      await insertItem(db, item);
      expect(await getItem(db, item.id)).toEqual(normalised(item));
    });
  }

  test("listItems returns a client's items", async () => {
    await insertItem(db, example("quick-win.json"));
    await insertItem(db, example("low-value-urgent.json"));
    await insertItem(db, example("blocked-integration.json"));
    expect((await listItems(db, "globex")).map((i) => i.id).sort()).toEqual([
      "01jb90a1b2c3d4e5f6g7h8j9km",
      "01jb90b1c2d3e4f5g6h7j8k9mn",
    ]);
  });
});

describe("revisions", () => {
  test("an update at the current revision succeeds and bumps it", async () => {
    const item = example("quick-win.json");
    await insertItem(db, item);
    const next = await updateItem(
      db,
      { ...item, title: "Rotate the deploy key today" },
      1,
    );
    expect(next).toBe(2);
    expect((await getItem(db, item.id))?.title).toBe(
      "Rotate the deploy key today",
    );
  });

  test("a stale revision is refused, and nothing changes", async () => {
    const item = example("quick-win.json");
    await insertItem(db, item);
    await updateItem(db, { ...item, title: "First writer" }, 1);
    await expect(
      updateItem(db, { ...item, title: "Second writer" }, 1),
    ).rejects.toBeInstanceOf(RevisionConflict);
    expect((await getItem(db, item.id))?.title).toBe("First writer");
  });
});

describe("constraints", () => {
  test("doneOn on an item that is not done is refused", async () => {
    await expect(
      insertItem(db, { ...example("quick-win.json"), doneOn: "2026-10-24" }),
    ).rejects.toThrow();
  });

  test("blocked details on an item that is not blocked are refused", async () => {
    const item = {
      ...example("quick-win.json"),
      blockedOn: { since: "2026-10-24", waitingFor: "someone" },
    };
    await expect(insertItem(db, item)).rejects.toThrow();
  });

  test("an id that is not lower-case words and hyphens is refused", async () => {
    await expect(
      insertItem(db, { ...example("quick-win.json"), id: "Not_Valid" }),
    ).rejects.toThrow();
  });

  test("a workstream that belongs to another client is refused", async () => {
    const item = example("blocked-integration.json");
    await expect(
      insertItem(db, { ...item, workstreamId: "estate-hygiene" }),
    ).rejects.toThrow();
  });

  test("an item without a workstream needs no workstream check", async () => {
    const item = { ...example("quick-win.json") };
    delete item.workstreamId;
    await insertItem(db, item);
    expect((await getItem(db, item.id))?.workstreamId).toBeUndefined();
  });

  test("an unknown client is refused", async () => {
    await expect(
      insertItem(db, { ...example("quick-win.json"), clientId: "nobody" }),
    ).rejects.toThrow();
  });
});

describe("append only", () => {
  test("the log grows but cannot be edited or deleted directly", async () => {
    const item = example("blocked-integration.json");
    await insertItem(db, item);
    await appendLog(db, item.id, {
      at: "2026-10-25T08:00:00Z",
      status: "doing",
      note: "Token arrived",
    });
    expect((await getItem(db, item.id))?.log).toHaveLength(3);
    await expect(
      pg.query("UPDATE item_log SET note = 'rewritten'"),
    ).rejects.toThrow(/append only/);
    await expect(pg.query("DELETE FROM item_log")).rejects.toThrow(
      /append only/,
    );
    await expect(
      pg.query("UPDATE item_history SET kind = 'edited'"),
    ).rejects.toThrow(/append only/);
  });

  test("deleting the item removes its log and history with it", async () => {
    const item = example("blocked-integration.json");
    await insertItem(db, item);
    await pg.query("DELETE FROM dashboard_item WHERE id = $1", [item.id]);
    const { rows } = await pg.query<{ n: number }>(
      "SELECT (SELECT count(*) FROM item_log) + (SELECT count(*) FROM item_history) AS n",
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe("search", () => {
  beforeEach(async () => {
    for (const name of [
      "quick-win.json",
      "low-value-urgent.json",
      "blocked-integration.json",
      "atlas-import.json",
    ]) {
      await insertItem(db, example(name));
    }
  });

  test("filters combine with AND", async () => {
    const all = await searchItems(db, {});
    const globex = await searchItems(db, { clientId: "globex" });
    const blocked = await searchItems(db, { blocked: true });
    expect(all).toHaveLength(4);
    expect(globex.length).toBeLessThan(all.length);
    expect(blocked.every((i) => i.blocked === true)).toBe(true);
    expect(
      await searchItems(db, { clientId: "globex", blocked: true }),
    ).toEqual(blocked.filter((i) => i.clientId === "globex"));
  });

  test("text matches title or summary, and LIKE wildcards are literal", async () => {
    const [first] = await searchItems(db, {});
    const word = first!.title.split(" ")[1]!;
    expect(
      (await searchItems(db, { text: word.toUpperCase() })).map((i) => i.id),
    ).toContain(first!.id);
    expect(await searchItems(db, { text: "%" })).toEqual([]);
  });

  test("search results carry no log or history", async () => {
    const results = await searchItems(db, {});
    expect(results.every((i) => !i.log && !i.history)).toBe(true);
  });
});

describe("claims", () => {
  const at = "2026-10-24T12:00:00Z";

  test("one agent claims; a second is refused until it is released", async () => {
    const item = example("quick-win.json");
    await insertItem(db, item);
    expect(await claimItem(db, item.id, "builder", at)).toBe(2);
    expect(await claimItem(db, item.id, "builder", at)).toBe(3);
    await expect(claimItem(db, item.id, "commander", at)).rejects.toEqual(
      new ClaimConflict(item.id, "builder"),
    );
    await expect(releaseItem(db, item.id, "commander", at)).rejects.toEqual(
      new ClaimConflict(item.id, "builder"),
    );
    await releaseItem(db, item.id, "builder", at);
    await claimItem(db, item.id, "commander", at);
    const read = await getItem(db, item.id);
    expect(read?.claim?.by).toBe("commander");
    expect(read?.history?.map((h) => h.kind)).toEqual([
      ...(item.history ?? []).map((h) => h.kind),
      "claimed",
      "claimed",
      "released",
      "claimed",
    ]);
  });

  test("force releases another agent's claim", async () => {
    const item = example("quick-win.json");
    await insertItem(db, item);
    await claimItem(db, item.id, "builder", at);
    await releaseItem(db, item.id, "commander", at, true);
    expect((await getItem(db, item.id))?.claim).toBeUndefined();
  });

  test("claiming an item that does not exist says so", async () => {
    await expect(claimItem(db, "nope", "builder", at)).rejects.toBeInstanceOf(
      ItemNotFound,
    );
  });
});
