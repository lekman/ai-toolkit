import type { IEmbeddingsProvider } from "../embeddings";
import type { ChunkRecord } from "../model";
import type { ISourceReader } from "../obsidian";
import type { IChunkStore } from "../store";
import type { ScanReport } from "./types";

import { OBSIDIAN_SOURCE, ObsidianSource } from "../obsidian";

/**
 * Days of store version history kept after a scan. The index is a derived
 * read model — deleting it and re-running ingestion rebuilds it — so version
 * history buys almost nothing. One day is kept, not zero, so a reader holding
 * an open snapshot while the scan compacts is never reading a pruned version.
 */
const VERSION_RETENTION_DAYS = 1;

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
   * Compaction runs once at the end, after every write: the store writes a
   * version per transaction and this loop writes one per file, so a scan of
   * 600 files leaves 600 versions behind unless they are reclaimed. Running
   * it here rather than on its own timer also means it never overlaps a
   * writer, because the only writer is the scan that just finished.
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
      const unchanged: ChunkRecord[] = [];
      for (const record of records) {
        const prior = byId.get(record.id);
        if (
          prior &&
          prior.contentHash === record.contentHash &&
          prior.embedding.length > 0
        ) {
          unchanged.push({ ...record, embedding: prior.embedding });
        } else {
          changed.push(record);
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
      if (
        existing.length > 0 &&
        existing.some((chunk) => !records.some((r) => r.id === chunk.id))
      ) {
        await store.deleteByPath(OBSIDIAN_SOURCE, file.relPath);
      }
      await store.upsert([...changed, ...unchanged]);
    }

    const indexedPaths = await store.listPaths(OBSIDIAN_SOURCE);
    const removedPaths = indexedPaths.filter((path) => !seenPaths.has(path));
    for (const path of removedPaths) {
      await store.deleteByPath(OBSIDIAN_SOURCE, path);
    }

    await store.optimize(Indexer.versionCutoff(now));

    return {
      chunkCount: await store.count(),
      embedded,
      removedPaths,
      scannedFiles,
      skippedUnreadable,
    };
  }

  /** Retention cutoff for store compaction: `now` less the retention window. */
  static versionCutoff(now: Date): Date {
    return new Date(now.getTime() - VERSION_RETENTION_DAYS * 86_400_000);
  }
}
