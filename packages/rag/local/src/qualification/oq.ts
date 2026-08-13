import type { IChunkStore, IEmbeddingsProvider } from "@lekman/rag-core";

import { SearchHandlers } from "@lekman/rag-core";

import type { CheckResult } from "../config";

/** Folder inside the vault where OQ writes its read-write fixture. */
export const OQ_FIXTURE_DIR = "_OQ";

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

  /** Read-only checks: store health, retrieval, exclusion and tier negatives. */
  static async readOnlyChecks(
    store: IChunkStore,
    embeddings: IEmbeddingsProvider,
    referenceQuery: string,
    freshnessDays: number,
    now: number,
  ): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    const count = await store.count();
    results.push({
      detail: `store holds ${count} chunks`,
      name: "store opens and is non-empty",
      pass: count > 0,
      remediation: count > 0 ? "" : "run `rag scan` to build the index",
    });

    const paths = await store.listPaths("obsidian");
    const newest = Math.max(
      0,
      ...(await Promise.all(
        paths.slice(0, 500).map(async (path) => {
          const [first] = await store.readPath("obsidian", path);
          return first?.modifiedAt ?? 0;
        }),
      )),
    );
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
