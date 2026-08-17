import type { IChunkStore, IEmbeddingsProvider } from "@lekman/rag-core";

import { SearchHandlers } from "@lekman/rag-core";

import type { CheckResult } from "../config";

/** Folder inside the vault where OQ writes its read-write fixture. */
export const OQ_FIXTURE_DIR = "_OQ";

/**
 * Upper bound on stored bytes per chunk before the store counts as bloated.
 * A chunk is a 1024-dimension vector (4 KiB) plus its text and metadata, so
 * a healthy store sits in the low tens of KiB per chunk once fragments and
 * one day of versions are counted. The bound is deliberately loose: it is
 * there to catch the failure mode that put this store at 485 KiB per chunk,
 * not to police normal variation.
 */
const MAX_BYTES_PER_CHUNK = 65_536;

/**
 * Operational qualification: proves the installed system works as intended.
 * Read-only checks run against the live store through ports, so they are
 * testable with fakes; the read-write flow and MCP round trip are driven by
 * the system runner.
 */
export class Oq {
  /** Fixture note content carrying a unique sentinel. */
  static fixture(sentinel: string): { content: string; relPath: string } {
    return {
      content: `---\ntype: oq-fixture\n---\n## OQ\n\nOperational qualification sentinel ${sentinel}.\n`,
      relPath: `${OQ_FIXTURE_DIR}/oq-${sentinel}.md`,
    };
  }

  /**
   * Read-only checks: store health, storage growth, retrieval, exclusion and
   * tier negatives. `storageBytes` is measured by the caller (system layer)
   * so these checks stay pure.
   */
  static async readOnlyChecks(
    store: IChunkStore,
    embeddings: IEmbeddingsProvider,
    referenceQuery: string,
    freshnessDays: number,
    now: number,
    storageBytes = 0,
  ): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    const count = await store.count();
    results.push({
      detail: `store holds ${count} chunks`,
      name: "store opens and is non-empty",
      pass: count > 0,
      remediation: count > 0 ? "" : "run `rag scan` to build the index",
    });

    // Growth guard. The store once reached 29 GB for 6,479 chunks because a
    // reconcile rewrote every file on every run and nothing reclaimed the
    // versions. Both causes are fixed; this check is what makes a return
    // visible instead of being found by a full disk.
    const perChunk = count > 0 ? storageBytes / count : 0;
    results.push({
      detail:
        storageBytes === 0
          ? "storage size not measured"
          : `${(storageBytes / 1_048_576).toFixed(0)} MiB for ${count} chunks (${(perChunk / 1024).toFixed(1)} KiB/chunk, bound ${MAX_BYTES_PER_CHUNK / 1024} KiB)`,
      name: "storage growth within bounds",
      pass: storageBytes === 0 || perChunk <= MAX_BYTES_PER_CHUNK,
      remediation:
        "check the scan report: upsertedFiles close to scannedFiles means the index is rewriting rows it already holds",
    });

    const paths = await store.listPaths("obsidian");
    // Every row, not a sample. The previous version read the first 500 of 607
    // paths and reported the newest of those — an index 0.7 days old showed as
    // 2.6, and a genuinely stale index could have shown as fresh.
    const newest = await store.newestModifiedAt("obsidian");
    const ageDays = (now - newest) / 86_400_000;
    results.push({
      detail: `newest indexed note is ${ageDays.toFixed(1)} days old (bound ${freshnessDays})`,
      name: "index freshness",
      pass: newest > 0 && ageDays <= freshnessDays,
      remediation: "run `rag scan`, or check the watcher agent is loaded",
    });

    // Clock starts here, not at `now` — `now` predates the freshness walk
    // above and would charge its I/O to the query latency.
    const started = Date.now();
    const hits = await SearchHandlers.search(
      store,
      embeddings,
      referenceQuery,
      {},
      5,
    );
    const latencyMs = Date.now() - started;
    const first = hits[0];
    const fieldsOk =
      first !== undefined &&
      first.chunk.path.length > 0 &&
      first.chunk.headingPath.length > 0 &&
      first.chunk.text.length > 0;
    results.push({
      detail: `reference query returned ${hits.length} hits in ${latencyMs}ms`,
      name: "reference query returns well-formed results",
      pass: fieldsOk && latencyMs < 5_000,
      remediation: "check VOYAGE_API_KEY and the store contents",
    });

    const excluded = paths.filter(
      (path) =>
        path.startsWith("Templates/") ||
        path.includes(".bak") ||
        / \d+\.md$/.test(path) ||
        path.startsWith("Dashboard"),
    );
    results.push({
      detail:
        excluded.length === 0
          ? "no excluded paths present in the index"
          : `found: ${excluded.join(", ")}`,
      name: "negative: excluded content absent",
      pass: excluded.length === 0,
      remediation: "fix Exclusions rules, then `rag scan` to reconcile",
    });

    const healthPaths = paths.filter((path) =>
      path.startsWith("Personal/Health/"),
    );
    results.push({
      detail:
        healthPaths.length === 0
          ? "no Personal/Health/ paths indexed"
          : `found: ${healthPaths.join(", ")}`,
      name: "negative: health content deferred (phase 1)",
      pass: healthPaths.length === 0,
      remediation: "fix Exclusions rules, then `rag scan` to reconcile",
    });

    const businessHits = await SearchHandlers.search(
      store,
      embeddings,
      referenceQuery,
      { tier: "private-business" },
      10,
    );
    const crossTier = businessHits.filter(
      (hit) => hit.chunk.tier !== "private-business",
    );
    results.push({
      detail:
        crossTier.length === 0
          ? "tier filter returned only private-business chunks"
          : `leaked: ${crossTier.length}`,
      name: "negative: tier filter holds",
      pass: crossTier.length === 0,
      remediation: "fix store filter handling — do not serve until resolved",
    });

    return results;
  }
}
