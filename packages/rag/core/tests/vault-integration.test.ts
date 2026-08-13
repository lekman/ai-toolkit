import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Indexer } from "../src/indexer";
import { VaultReader } from "../src/obsidian";
import { EmbeddingsMock } from "./mocks/embeddings.mock";
import { StoreMock } from "./mocks/store.mock";

const VAULT = join(import.meta.dir, "fixtures/vault");

describe("fixture vault end to end (real files, mock store + embeddings)", () => {
  test("only eligible notes are indexed; every excluded pattern yields zero chunks", async () => {
    const store = new StoreMock();
    const report = await Indexer.scan(
      new VaultReader(VAULT),
      store,
      new EmbeddingsMock(),
    );

    const paths = await store.listPaths("obsidian");
    expect(paths).toEqual([
      "Clients/AcmeCo/Strategy.md",
      "Personal/Projects/Workshop.md",
    ]);
    expect(report.chunkCount).toBe(2);

    // Negative: none of the excluded files contributed a chunk.
    const all = [...store.chunks.values()].map((chunk) => chunk.path);
    for (const excluded of [
      "Dashboard.md",
      "Templates/Meeting.md",
      "Clients/AcmeCo/Strategy 2.md",
      "Clients/AcmeCo/Notes.bak-old.md",
      "Personal/Health/Sleep.md",
      ".obsidian/app.md",
    ]) {
      expect(all).not.toContain(excluded);
    }
  });

  test("tiers derived from the folder map", async () => {
    const store = new StoreMock();
    await Indexer.scan(new VaultReader(VAULT), store, new EmbeddingsMock());
    const byPath = new Map(
      [...store.chunks.values()].map((chunk) => [chunk.path, chunk]),
    );
    expect(byPath.get("Clients/AcmeCo/Strategy.md")?.tier).toBe(
      "private-business",
    );
    expect(byPath.get("Personal/Projects/Workshop.md")?.tier).toBe("private");
  });
});
