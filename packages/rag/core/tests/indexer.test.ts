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

type RemovalRefusalReason = "mass-removal" | "vault-empty" | undefined;

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

  test("an excluded file is never read, so it cannot be reported unreadable", async () => {
    const { embeddings, reader, store } = setup();
    // Unreadable AND excluded. Before the exclusion check moved ahead of the
    // read, this surfaced in skippedUnreadable and read like a real miss.
    reader.set("_Drafts/half-written.md", null, 1);
    const report = await Indexer.scan(reader, store, embeddings);
    expect(report.skippedUnreadable).toEqual([]);
    expect(await store.listPaths("obsidian")).not.toContain(
      "_Drafts/half-written.md",
    );
  });

  const refusalCases: [number, number, number, RemovalRefusalReason][] = [
    // indexedPaths, wouldRemove, filesFound, expected reason
    [626, 626, 0, "vault-empty"],
    [626, 500, 7, "mass-removal"],
    [626, 314, 400, "mass-removal"],
    // exactly half is not "more than half" — the boundary reconciles
    [100, 50, 60, undefined],
    [100, 51, 60, "mass-removal"],
    // below the floor a large share is normal, not a symptom
    [19, 19, 3, undefined],
    // an empty index cannot be destroyed, and a quiet scan is not a refusal
    [0, 0, 0, undefined],
    [626, 0, 626, undefined],
    [626, 3, 623, undefined],
  ];

  test.each(refusalCases)(
    "removalRefusal(%i indexed, %i to remove, %i found) -> %s",
    (indexed, wouldRemove, found, reason) => {
      expect(Indexer.removalRefusal(indexed, wouldRemove, found)?.reason).toBe(
        reason,
      );
    },
  );

  test.each([
    ["an empty file", ""],
    ["a frontmatter-only stub", "---\ntype: note\nclient: AcmeCo\n---\n"],
    ["whitespace only", "   \n\n  \n"],
  ])("%s is reported, not silently dropped", async (_label, content) => {
    const { embeddings, reader, store } = setup();
    reader.set("Clients/AcmeCo/Stub.md", content, 1);
    const report = await Indexer.scan(reader, store, embeddings);

    expect(report.skippedNoChunks).toEqual(["Clients/AcmeCo/Stub.md"]);
    // It is not a read failure, and it is not a scanned file. Before this it
    // was neither, which is how two notes went missing from a clean report.
    expect(report.skippedUnreadable).toEqual([]);
    expect(await store.listPaths("obsidian")).not.toContain(
      "Clients/AcmeCo/Stub.md",
    );
  });

  test("an excluded file is not reported as yielding no chunks", async () => {
    const { embeddings, reader, store } = setup();
    // toRecords also returns [] for exclusions. The scan checks exclusions
    // before the read, so that can no longer land in this bucket — assert it,
    // because the whole value of the field is that it means one thing.
    reader.set("_Drafts/scratch.md", "# Draft\n\nreal body text", 1);
    const report = await Indexer.scan(reader, store, embeddings);
    expect(report.skippedNoChunks).toEqual([]);
  });

  test("a note that empties still has its stale chunks reconciled away", async () => {
    const { embeddings, reader, store } = setup();
    reader.set("Clients/AcmeCo/Fading.md", "# Fading\n\nbody text", 1);
    await Indexer.scan(reader, store, embeddings);
    expect(await store.listPaths("obsidian")).toContain(
      "Clients/AcmeCo/Fading.md",
    );

    reader.set("Clients/AcmeCo/Fading.md", "", 2);
    const report = await Indexer.scan(reader, store, embeddings);
    expect(report.skippedNoChunks).toEqual(["Clients/AcmeCo/Fading.md"]);
    expect(report.removedPaths).toEqual(["Clients/AcmeCo/Fading.md"]);
    expect(await store.listPaths("obsidian")).not.toContain(
      "Clients/AcmeCo/Fading.md",
    );
  });

  test("a vault that yields no files does not destroy the index", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    const before = await store.listPaths("obsidian");
    expect(before.length).toBeGreaterThan(0);

    // The 2026-08-22 shape: the configured path still resolves, but the vault
    // behind it is gone.
    reader.files.clear();
    const report = await Indexer.scan(reader, store, embeddings);

    expect(report.refusedRemoval).toEqual({
      indexedPaths: before.length,
      reason: "vault-empty",
      wouldRemove: before.length,
    });
    expect(report.removedPaths).toEqual([]);
    // The whole point: the index survived.
    expect(await store.listPaths("obsidian")).toEqual(before);
  });

  test("a single genuine deletion still reconciles", async () => {
    const { embeddings, reader, store } = setup();
    await Indexer.scan(reader, store, embeddings);
    // Positive control. Without this, "nothing was deleted" would pass even
    // if the guard had jammed the reconcile shut entirely.
    reader.files.delete("Personal/Projects/Workshop.md");
    const report = await Indexer.scan(reader, store, embeddings);
    expect(report.refusedRemoval).toBeUndefined();
    expect(report.removedPaths).toEqual(["Personal/Projects/Workshop.md"]);
  });

  test("a path that becomes excluded has its old chunks reconciled away", async () => {
    const { embeddings, reader, store } = setup();
    reader.set("_Drafts/promoted.md", "# Draft\n\nbody text here", 1);
    await Indexer.scan(reader, store, embeddings);
    // Excluded from the first scan onward — it must never be in the store.
    expect(await store.listPaths("obsidian")).not.toContain(
      "_Drafts/promoted.md",
    );
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

  test("compacts once per scan that wrote, after the writes", async () => {
    const { embeddings, reader, store } = setup();
    const now = new Date("2026-08-15T12:00:00.000Z");
    await Indexer.scan(reader, store, embeddings, now);
    expect(store.optimizeCalls).toHaveLength(1);
    expect(store.optimizeCalls[0]?.toISOString()).toBe(
      "2026-08-15T11:00:00.000Z",
    );
  });

  test("skips compaction when a scan writes nothing", async () => {
    const { embeddings, reader, store } = setup();
    const now = new Date("2026-08-15T12:00:00.000Z");
    await Indexer.scan(reader, store, embeddings, now);
    await Indexer.scan(reader, store, embeddings, now);
    // The second run upserts nothing and removes nothing, so there is no new
    // version to reclaim — and compaction is itself a table rewrite, so
    // running it here is what grew the store: ~50 retained ~25 MB copies of
    // an unchanged table, measured 19 Aug. An earlier version of this test
    // asserted the opposite on the grounds that per-file upserts still
    // accrued versions; that stopped being true when unchanged rows stopped
    // being rewritten.
    expect(store.optimizeCalls).toHaveLength(1);
  });

  test("a removed-path-only scan still compacts", async () => {
    const { embeddings, reader, store } = setup();
    const now = new Date("2026-08-15T12:00:00.000Z");
    await Indexer.scan(reader, store, embeddings, now);
    reader.files.delete("Clients/AcmeCo/Commercials.md");
    const report = await Indexer.scan(reader, store, embeddings, now);
    // A deletion is a write: it creates a version even though no file was
    // upserted, so the reclaim must still run.
    expect(report.upsertedFiles).toBe(0);
    expect(report.removedPaths).toEqual(["Clients/AcmeCo/Commercials.md"]);
    expect(store.optimizeCalls).toHaveLength(2);
  });
});

describe("Indexer.versionCutoff", () => {
  test("keeps one hour of history", () => {
    const cutoff = Indexer.versionCutoff(new Date("2026-08-15T12:00:00.000Z"));
    expect(cutoff.toISOString()).toBe("2026-08-15T11:00:00.000Z");
  });
});

describe("store freshness", () => {
  test("newestModifiedAt considers every path, not a prefix", async () => {
    // The OQ check sampled the first 500 of 607 paths and reported the newest
    // of the sample: an index 0.7 days old read as 2.6 days. A freshness
    // answer that looks at part of the data is not a freshness answer.
    const { embeddings, reader, store } = setup();
    reader.set(
      "Zzz/newest.md",
      `---\ntype: note\n---\n## Late\n\nSorts last.\n`,
      9999,
    );
    await Indexer.scan(reader, store, embeddings);
    const paths = await store.listPaths("obsidian");
    expect(paths[paths.length - 1]).toBe("Zzz/newest.md");
    expect(await store.newestModifiedAt("obsidian")).toBe(9999);
  });

  test("an empty store reports 0 rather than a stale maximum", async () => {
    expect(await new StoreMock().newestModifiedAt("obsidian")).toBe(0);
  });
});
