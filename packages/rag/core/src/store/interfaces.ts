import type { ChunkRecord, SearchFilters, SearchResult } from "../model";

/** Port every chunk store implements; local and cloud share this contract. */
export interface IChunkStore {
  /** Total number of stored chunks. */
  count(): Promise<number>;
  /** Remove every chunk for one source file (deletions and renames). */
  deleteByPath(source: string, path: string): Promise<void>;
  /** Distinct file paths currently indexed for a source (reconciliation). */
  listPaths(source: string): Promise<string[]>;
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
