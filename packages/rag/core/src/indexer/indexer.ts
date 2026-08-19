import type { IEmbeddingsProvider } from "../embeddings";
import type { ChunkRecord } from "../model";
import type { ISourceReader } from "../obsidian";
import type { IChunkStore } from "../store";
import type { ScanReport } from "./types";

import { OBSIDIAN_SOURCE, ObsidianSource } from "../obsidian";

/**
 * Hours of store version history kept after a scan. The index is a derived
 * read model — deleting it and re-running ingestion rebuilds it — so version
 * history buys almost nothing. One hour is kept, not zero, so a query in
 * flight while the scan compacts is never reading a pruned version; every
 * store read opens the table fresh, so nothing holds a snapshot longer than
 * one call. A day was kept before, and it multiplied the compaction copies
 * below into 1.3 GB of retained table rewrites.
 */
const VERSION_RETENTION_HOURS = 1;

/**
 * The ingestion pipeline: full-scan reconcile of a source into a store.
 * All I/O arrives through ports (reader, store, embeddings), so the logic
 * here is testable with in-memory fakes and no mocks of this class itself.
 */
export class Indexer {
  /**
   * Scan the whole source: build records for every eligible file, re-embed
   * only chunks whose content hash changed, upsert, and remove chunks for
   * files that no longer exist. Idempotent — a second run with no source
   * changes embeds nothing and changes nothing.
   *
   * Compaction runs once at the end, and only after a scan that wrote: the
   * store writes a version per transaction and this loop writes one per
   * file, so a scan of 600 files leaves 600 versions behind unless they are
   * reclaimed. Running it here rather than on its own timer also means it
   * never overlaps a writer, because the only writer is the scan that just
   * finished. A no-op scan skips it: compaction itself rewrites the table
   * into a fresh ~25 MB fragment, and running that after every
   * watcher-triggered reconcile kept ~50 retained copies of an unchanged
   * table — the growth the OQ storage guard flagged on 18 Aug.
   *
   * `now` is injected so the retention cutoff is deterministic under test.
   */
  static async scan(
    reader: ISourceReader,
    store: IChunkStore,
    embeddings: IEmbeddingsProvider,
    now: Date = new Date(),
  ): Promise<ScanReport> {
    const files = await reader.listFiles();
    const seenPaths = new Set<string>();
    const skippedUnreadable: string[] = [];
    let embedded = 0;
    let scannedFiles = 0;
    let upsertedFiles = 0;

    for (const file of files) {
      const content = await reader.readFile(file.relPath);
      if (content === null) {
        // Unavailable content (e.g. an iCloud-evicted stub): skip, and keep
        // the path marked as seen so reconcile never deletes good chunks
        // just because the file was momentarily unreadable.
        skippedUnreadable.push(file.relPath);
        seenPaths.add(file.relPath);
        continue;
      }
      const records = ObsidianSource.toRecords(
        file.relPath,
        content,
        file.modifiedAt,
      );
      if (records.length === 0) continue;
      scannedFiles += 1;
      seenPaths.add(file.relPath);

      const existing = await store.readPath(OBSIDIAN_SOURCE, file.relPath);
      const byId = new Map(existing.map((chunk) => [chunk.id, chunk]));
      const changed: ChunkRecord[] = [];
      const stale: ChunkRecord[] = [];
      const identical: ChunkRecord[] = [];
      for (const record of records) {
        const prior = byId.get(record.id);
        if (
          !prior ||
          prior.contentHash !== record.contentHash ||
          prior.embedding.length === 0
        ) {
          changed.push(record);
        } else if (prior.modifiedAt === record.modifiedAt) {
          identical.push({ ...record, embedding: prior.embedding });
        } else {
          // Same content, newer mtime: no re-embed, but the stored row must
          // still be refreshed or list_recent orders by a stale timestamp.
          stale.push({ ...record, embedding: prior.embedding });
        }
      }

      if (changed.length > 0) {
        const vectors = await embeddings.embed(
          changed.map((chunk) => chunk.text),
        );
        changed.forEach((chunk, index) => {
          chunk.embedding = vectors[index] ?? [];
        });
        embedded += changed.length;
      }

      // A structural change (chunk removed/renamed) leaves stale IDs behind;
      // clearing the path before the upsert keeps the file's chunk set exact.
      const structural =
        existing.length > 0 &&
        existing.some((chunk) => !records.some((r) => r.id === chunk.id));
      if (structural) {
        await store.deleteByPath(OBSIDIAN_SOURCE, file.relPath);
      }

      // Write only what the store does not already hold. Rewriting identical
      // rows is what made the store grow: every upsert is a new version, and
      // a reconcile that rewrote all 607 files on every run wrote ~26,700
      // versions a day for a vault where one note had changed. After a
      // structural delete there is nothing left to keep, so everything goes.
      const toWrite = structural
        ? [...changed, ...stale, ...identical]
        : [...changed, ...stale];
      if (toWrite.length > 0) {
        await store.upsert(toWrite);
        upsertedFiles += 1;
      }
    }

    const indexedPaths = await store.listPaths(OBSIDIAN_SOURCE);
    const removedPaths = indexedPaths.filter((path) => !seenPaths.has(path));
    for (const path of removedPaths) {
      await store.deleteByPath(OBSIDIAN_SOURCE, path);
    }

    if (upsertedFiles > 0 || removedPaths.length > 0) {
      await store.optimize(Indexer.versionCutoff(now));
    }

    return {
      chunkCount: await store.count(),
      embedded,
      removedPaths,
      scannedFiles,
      skippedUnreadable,
      upsertedFiles,
    };
  }

  /** Retention cutoff for store compaction: `now` less the retention window. */
  static versionCutoff(now: Date): Date {
    return new Date(now.getTime() - VERSION_RETENTION_HOURS * 3_600_000);
  }
}
