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
