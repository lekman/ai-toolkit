import { describe, expect, test } from "bun:test";

import { Indexer } from "../src/indexer";
import { SearchHandlers } from "../src/mcp";
import { EmbeddingsMock } from "./mocks/embeddings.mock";
import { ReaderMock } from "./mocks/reader.mock";
import { StoreMock } from "./mocks/store.mock";

const NOTE_A = `---\ntype: note\nclient: AcmeCo\n---\n## Pricing\n\nAcmeCo prefers fixed-price milestones.\n`;
const NOTE_B = `---\ntype: note\n---\n## Woodworking\n\nDovetail joints need a marking gauge.\n`;

const setup = () => {
  const reader = new ReaderMock();
  const store = new StoreMock();
  const embeddings = new EmbeddingsMock();
  reader.set("Clients/AcmeCo/Commercials.md", NOTE_A, 100);
  reader.set("Personal/Projects/Workshop.md", NOTE_B, 200);
  reader.set("Templates/Template.md", NOTE_B, 300);
  return { embeddings, reader, store };
};

describe("Indexer.scan", () => {
  test("indexes eligible files only; excluded paths produce zero chunks", async () => {
    const { embeddings, reader, store } = setup();
    const report = await Indexer.scan(reader, store, embeddings);
    expect(report.scannedFiles).toBe(2);
    expect(report.chunkCount).toBe(2);
    const paths = await store.listPaths("obsidian");
    expect(paths).toEqual([
      "Clients/AcmeCo/Commercials.md",
      "Personal/Projects/Workshop.md",
    ]);
  });

  test("second run with no changes embeds nothing (idempotent)", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    const first = embeddings.embeddedCount;
    const report = await Indexer.scan(reader, store, embeddings);
    expect(embeddings.embeddedCount).toBe(first);
    expect(report.embedded).toBe(0);
  });

  test("editing one file re-embeds only that file's chunks", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    const before = new Map(store.chunks);

    reader.set(
      "Clients/AcmeCo/Commercials.md",
      NOTE_A.replace("fixed-price", "time-and-materials"),
      150,
    );
    const report = await Indexer.scan(reader, store, embeddings);

    expect(report.embedded).toBe(1);
    const untouched = [...store.chunks.values()].find(
      (c) => c.path === "Personal/Projects/Workshop.md",
    );
    const priorUntouched = [...before.values()].find(
      (c) => c.path === "Personal/Projects/Workshop.md",
    );
    expect(untouched?.embedding).toEqual(priorUntouched?.embedding ?? []);
  });

  test("deleted files have their chunks removed", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    reader.files.delete("Personal/Projects/Workshop.md");
    const report = await Indexer.scan(reader, store, embeddings);
    expect(report.removedPaths).toEqual(["Personal/Projects/Workshop.md"]);
    expect(await store.listPaths("obsidian")).toEqual([
      "Clients/AcmeCo/Commercials.md",
    ]);
  });

  test("evicted (unreadable) files are skipped, never indexed empty", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    reader.set("Clients/AcmeCo/Commercials.md", null, 999);
    const report = await Indexer.scan(reader, store, embeddings);
    expect(report.skippedUnreadable).toEqual(["Clients/AcmeCo/Commercials.md"]);
    // The previously indexed content survives — skip is not delete.
    expect(
      await store.readPath("obsidian", "Clients/AcmeCo/Commercials.md"),
    ).not.toEqual([]);
  });
});

describe("SearchHandlers over an indexed store", () => {
  test("tier filter never returns the other tier (negative + positive)", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);

    const business = await SearchHandlers.search(
      store,
      embeddings,
      "milestones",
      { tier: "private-business" },
      10,
    );
    expect(business.length).toBeGreaterThan(0);
    expect(business.every((hit) => hit.chunk.tier === "private-business")).toBe(
      true,
    );

    const privateHits = await SearchHandlers.search(
      store,
      embeddings,
      "milestones",
      { tier: "private" },
      10,
    );
    expect(privateHits.every((hit) => hit.chunk.tier === "private")).toBe(true);
    expect(
      privateHits.some((hit) => hit.chunk.path.startsWith("Clients/")),
    ).toBe(false);
  });

  test("get_note reassembles a full document", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    const doc = await SearchHandlers.getDocument(
      store,
      "Clients/AcmeCo/Commercials.md",
    );
    expect(doc?.text).toContain("fixed-price");
    expect(doc?.metadata["client"]).toBe("AcmeCo");
  });

  test("list_recent orders by modification time", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    const recent = await SearchHandlers.listRecent(store, 5);
    expect(recent[0]?.path).toBe("Personal/Projects/Workshop.md");
  });

  test("a quiet reconcile writes nothing to the store", async () => {
    const { embeddings, reader, store } = setup();
    const first = await Indexer.scan(reader, store, embeddings);
    expect(first.upsertedFiles).toBe(2);

    const second = await Indexer.scan(reader, store, embeddings);
    // Nothing changed, so nothing is written. Rewriting rows the store
    // already holds is what grew the data directory to 29 GB.
    expect(second.upsertedFiles).toBe(0);
    expect(second.embedded).toBe(0);
    expect(second.chunkCount).toBe(2);
  });

  test("only the edited file writes, not the whole vault", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    reader.set(
      "Personal/Projects/Workshop.md",
      `---\ntype: note\n---\n## Woodworking\n\nA marking gauge scores the shoulder line.\n`,
      400,
    );
    const report = await Indexer.scan(reader, store, embeddings);
    expect(report.upsertedFiles).toBe(1);
  });

  test("a touched but unedited file still refreshes its timestamp", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    reader.set("Clients/AcmeCo/Commercials.md", NOTE_A, 999);
    const report = await Indexer.scan(reader, store, embeddings);
    // Same content, so no re-embed — but the row must be rewritten or
    // list_recent would keep ordering by the old mtime.
    expect(report.embedded).toBe(0);
    expect(report.upsertedFiles).toBe(1);
    const recent = await SearchHandlers.listRecent(store, 5);
    expect(recent[0]?.path).toBe("Clients/AcmeCo/Commercials.md");
  });

  test("compacts once per scan, after the writes", async () => {
    const { embeddings, reader, store } = setup();
    const now = new Date("2026-08-15T12:00:00.000Z");
    await Indexer.scan(reader, store, embeddings, now);
    expect(store.optimizeCalls).toHaveLength(1);
    expect(store.optimizeCalls[0]?.toISOString()).toBe(
      "2026-08-14T12:00:00.000Z",
    );
  });

  test("compacts even when a scan writes nothing", async () => {
    const { embeddings, reader, store } = setup();
    const now = new Date("2026-08-15T12:00:00.000Z");
    await Indexer.scan(reader, store, embeddings, now);
    await Indexer.scan(reader, store, embeddings, now);
    // Second run re-embeds nothing, but versions still accrue from the
    // per-file upserts, so skipping compaction on a no-op scan would let the
    // store grow on exactly the runs that look harmless.
    expect(store.optimizeCalls).toHaveLength(2);
  });
});

describe("Indexer.versionCutoff", () => {
  test("keeps one day of history", () => {
    const cutoff = Indexer.versionCutoff(new Date("2026-08-15T12:00:00.000Z"));
    expect(cutoff.toISOString()).toBe("2026-08-14T12:00:00.000Z");
  });
});
