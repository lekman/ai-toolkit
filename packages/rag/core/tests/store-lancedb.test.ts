import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChunkRecord } from "../src/model";

import { LanceDbChunkStore } from "../src/store";

const dir = mkdtempSync(join(tmpdir(), "rag-lancedb-"));

afterAll(() => rmSync(dir, { force: true, recursive: true }));

const record = (
  id: string,
  path: string,
  vector: number[],
  overrides: Partial<ChunkRecord> = {},
): ChunkRecord => ({
  contentHash: `hash-${id}`,
  embedding: vector,
  headingPath: `Note › ${id}`,
  id,
  metadata: { type: "note" },
  modifiedAt: 1,
  ordinal: 0,
  path,
  source: "obsidian",
  text: `text ${id}`,
  tier: "private-business",
  ...overrides,
});

describe("LanceDbChunkStore (real embedded database)", () => {
  const store = new LanceDbChunkStore(dir);

  test("empty store reports zero and searches empty", async () => {
    expect(await store.count()).toBe(0);
    expect(await store.search([1, 0, 0, 0], {}, 5)).toEqual([]);
  });

  test("upsert, count, and read back", async () => {
    await store.upsert([
      record("aaa", "Clients/AcmeCo/A.md", [1, 0, 0, 0]),
      record("bbb", "Personal/B.md", [0, 1, 0, 0], {
        ordinal: 0,
        tier: "private",
      }),
    ]);
    expect(await store.count()).toBe(2);
    const chunks = await store.readPath("obsidian", "Clients/AcmeCo/A.md");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.metadata["type"]).toBe("note");
  });

  test("vector search respects tier filter (positive + negative)", async () => {
    const hits = await store.search(
      [1, 0, 0, 0],
      { tier: "private-business" },
      5,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.chunk.tier === "private-business")).toBe(
      true,
    );
    const wrongTier = await store.search(
      [1, 0, 0, 0],
      { tier: "shared-business" },
      5,
    );
    expect(wrongTier).toEqual([]);
  });

  test("upsert by same id replaces, not duplicates", async () => {
    await store.upsert([
      record("aaa", "Clients/AcmeCo/A.md", [0.9, 0.1, 0, 0], {
        text: "updated",
      }),
    ]);
    expect(await store.count()).toBe(2);
    const chunks = await store.readPath("obsidian", "Clients/AcmeCo/A.md");
    expect(chunks[0]?.text).toBe("updated");
  });

  test("deleteByPath removes a file's chunks", async () => {
    await store.deleteByPath("obsidian", "Personal/B.md");
    expect(await store.listPaths("obsidian")).toEqual(["Clients/AcmeCo/A.md"]);
  });
});
