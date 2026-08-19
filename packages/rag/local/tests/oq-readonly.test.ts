import { Indexer } from "@lekman/rag-core";
import { describe, expect, test } from "bun:test";

import { EmbeddingsMock } from "../../core/tests/mocks/embeddings.mock";
import { ReaderMock } from "../../core/tests/mocks/reader.mock";
import { StoreMock } from "../../core/tests/mocks/store.mock";
import { Oq } from "../src/qualification";

const NOTE = `---\ntype: note\n---\n## Architecture decisions\n\nWe decided on an embedded store.\n`;

describe("Oq.readOnlyChecks against a healthy indexed store", () => {
  test("all read-only checks pass, including the negatives", async () => {
    const reader = new ReaderMock();
    const store = new StoreMock();
    const embeddings = new EmbeddingsMock();
    const now = Date.now();
    reader.set("Clients/AcmeCo/Decisions.md", NOTE, now - 1_000);
    await Indexer.scan(reader, store, embeddings);

    const results = await Oq.readOnlyChecks(
      store,
      embeddings,
      "architecture decisions",
      30,
      now,
      64 * 1024, // one chunk, well inside the per-chunk bound
    );
    expect(results.map((result) => [result.name, result.pass])).toEqual([
      ["store opens and is non-empty", true],
      ["storage growth within bounds", true],
      ["index freshness", true],
      ["reference query returns well-formed results", true],
      ["negative: excluded content absent", true],
      ["negative: health content deferred (phase 1)", true],
      ["negative: tier filter holds", true],
    ]);
  });

  test("date-suffixed titles in the store do not fail the exclusion check", async () => {
    // The #24 regression shape: the indexer's rules admit a trailing year,
    // and an inline copy of the rules here used to flag it as a phantom
    // conflict copy — a correct index reporting as a leak.
    const reader = new ReaderMock();
    const store = new StoreMock();
    const embeddings = new EmbeddingsMock();
    const now = Date.now();
    reader.set("Clients/AcmeCo/Decisions.md", NOTE, now - 1_000);
    reader.set("Clients/AcmeCo/Reports/Weekly call — 14 August 2026.md", NOTE, now - 1_000);
    reader.set("Clients/AcmeCo/Budget 2026.md", NOTE, now - 1_000);
    await Indexer.scan(reader, store, embeddings);

    const results = await Oq.readOnlyChecks(
      store,
      embeddings,
      "architecture decisions",
      30,
      now,
    );
    const row = results.find(
      (result) => result.name === "negative: excluded content absent",
    );
    expect(row?.pass).toBe(true);
  });

  test("genuinely excluded content in the store still fails the check", async () => {
    const store = new StoreMock();
    const embeddings = new EmbeddingsMock();
    const now = Date.now();
    // Injected directly: the indexer would refuse these, which is exactly why
    // their presence in a live store must fail OQ.
    const chunk = (id: string, path: string) => ({
      contentHash: id,
      embedding: [0],
      headingPath: "t",
      id,
      metadata: {},
      modifiedAt: now,
      ordinal: 0,
      path,
      source: "obsidian",
      text: "t",
      tier: "private-business" as const,
    });
    await store.upsert([
      chunk("a", "Clients/AcmeCo/Note 2.md"),
      chunk("b", "Clients/AcmeCo/old.md.bak"),
      chunk("c", "Templates/Weekly.md"),
      chunk("d", "Dashboard.md"),
    ]);

    const results = await Oq.readOnlyChecks(
      store,
      embeddings,
      "architecture decisions",
      30,
      now,
    );
    const row = results.find(
      (result) => result.name === "negative: excluded content absent",
    );
    expect(row?.pass).toBe(false);
    expect(row?.detail).toContain("Note 2.md");
    expect(row?.detail).toContain("old.md.bak");
    expect(row?.detail).toContain("Templates/Weekly.md");
    expect(row?.detail).toContain("Dashboard.md");
  });

  test("health paths belong to the health row, not the exclusion row", async () => {
    const store = new StoreMock();
    const embeddings = new EmbeddingsMock();
    const now = Date.now();
    await store.upsert([
      {
        contentHash: "h",
        embedding: [0],
        headingPath: "t",
        id: "h",
        metadata: {},
        modifiedAt: now,
        ordinal: 0,
        path: "Personal/Health/journal.md",
        source: "obsidian",
        text: "t",
        tier: "private-business" as const,
      },
    ]);

    const results = await Oq.readOnlyChecks(
      store,
      embeddings,
      "architecture decisions",
      30,
      now,
    );
    const exclusionRow = results.find(
      (result) => result.name === "negative: excluded content absent",
    );
    const healthRow = results.find(
      (result) => result.name === "negative: health content deferred (phase 1)",
    );
    expect(exclusionRow?.pass).toBe(true);
    expect(healthRow?.pass).toBe(false);
  });

  test("negative: a bloated store fails the growth guard", async () => {
    const reader = new ReaderMock();
    const store = new StoreMock();
    const embeddings = new EmbeddingsMock();
    const now = Date.now();
    reader.set("Clients/AcmeCo/Decisions.md", NOTE, now - 1_000);
    await Indexer.scan(reader, store, embeddings);

    // 485 KiB/chunk — what the live store actually measured before the fix.
    const results = await Oq.readOnlyChecks(
      store,
      embeddings,
      "architecture decisions",
      30,
      now,
      485 * 1024,
    );
    const guard = results.find(
      (result) => result.name === "storage growth within bounds",
    );
    expect(guard?.pass).toBe(false);
    expect(guard?.remediation).toContain("upsertedFiles");
  });

  test("an unmeasured store size does not fail the growth guard", async () => {
    const reader = new ReaderMock();
    const store = new StoreMock();
    const embeddings = new EmbeddingsMock();
    reader.set("Clients/AcmeCo/Decisions.md", NOTE, Date.now() - 1_000);
    await Indexer.scan(reader, store, embeddings);

    const results = await Oq.readOnlyChecks(
      store,
      embeddings,
      "architecture decisions",
      30,
      Date.now(),
    );
    const guard = results.find(
      (result) => result.name === "storage growth within bounds",
    );
    expect(guard?.pass).toBe(true);
    expect(guard?.detail).toContain("not measured");
  });

  test("an empty store fails the first check with remediation", async () => {
    const results = await Oq.readOnlyChecks(
      new StoreMock(),
      new EmbeddingsMock(),
      "anything",
      30,
      Date.now(),
    );
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.remediation).toContain("rag scan");
  });
});
