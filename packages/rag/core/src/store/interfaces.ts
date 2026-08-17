import type { ChunkRecord, SearchFilters, SearchResult } from "../model";

/** Port every chunk store implements; local and cloud share this contract. */
export interface IChunkStore {
  /** Total number of stored chunks. */
  count(): Promise<number>;
  /** Remove every chunk for one source file (deletions and renames). */
  deleteByPath(source: string, path: string): Promise<void>;
  /** Distinct file paths currently indexed for a source (reconciliation). */
  listPaths(source: string): Promise<string[]>;
  /**
   * Newest `modifiedAt` across a source, or 0 when empty.
   *
   * A freshness answer has to consider every row. Sampling the first N paths
   * reports the newest *of the sample* and reads as the newest overall — the
   * OQ check did exactly that over the first 500 of 607 paths, and reported an
   * index 2.6 days stale when it was 0.7.
   */
  newestModifiedAt(source: string): Promise<number>;
  /**
   * Reclaim storage: merge fragments and drop versions older than `olderThan`.
   * A store that manages its own storage implements this as a no-op. Callers
   * run it after a write batch, never concurrently with one.
   */
  optimize(olderThan: Date): Promise<void>;
  /** All chunks for one file, ordered by ordinal (document reassembly). */
  readPath(source: string, path: string): Promise<ChunkRecord[]>;
  /** Vector search with metadata filters; returns the top-k hits. */
  search(
    queryVector: number[],
    filters: SearchFilters,
    limit: number,
  ): Promise<SearchResult[]>;
  /** Insert or replace chunks by ID. */
  upsert(chunks: ChunkRecord[]): Promise<void>;
}
