import type { ChunkRecord, SearchFilters, SearchResult } from "../../src/model";
import type { IChunkStore } from "../../src/store";

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
};

/** In-memory ChunkStore with cosine search, for integration tests. */
export class StoreMock implements IChunkStore {
  /** Backing map keyed by chunk id. */
  readonly chunks = new Map<string, ChunkRecord>();

  /** Total stored chunks. */
  async count(): Promise<number> {
    return this.chunks.size;
  }

  /** Remove a file's chunks. */
  async deleteByPath(source: string, path: string): Promise<void> {
    for (const [id, chunk] of this.chunks) {
      if (chunk.source === source && chunk.path === path)
        this.chunks.delete(id);
    }
  }

  /** Distinct indexed paths for a source. */
  async listPaths(source: string): Promise<string[]> {
    const paths = new Set<string>();
    for (const chunk of this.chunks.values()) {
      if (chunk.source === source) paths.add(chunk.path);
    }
    return [...paths].sort();
  }

  /** Recorded retention cutoffs, one per optimize call. */
  readonly optimizeCalls: Date[] = [];

  /** Record the call; an in-memory store has nothing to reclaim. */
  async optimize(olderThan: Date): Promise<void> {
    this.optimizeCalls.push(olderThan);
  }

  /** A file's chunks in ordinal order. */
  async readPath(source: string, path: string): Promise<ChunkRecord[]> {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.source === source && chunk.path === path)
      .sort((a, b) => a.ordinal - b.ordinal);
  }

  /** Cosine-similarity search with filters. */
  async search(
    queryVector: number[],
    filters: SearchFilters,
    limit: number,
  ): Promise<SearchResult[]> {
    return [...this.chunks.values()]
      .filter((chunk) => {
        if (filters.tier && chunk.tier !== filters.tier) return false;
        if (filters.source && chunk.source !== filters.source) return false;
        if (!filters.includeArchived && chunk.metadata["status"] === "archived")
          return false;
        if (filters.client && chunk.metadata["client"] !== filters.client)
          return false;
        if (filters.type && chunk.metadata["type"] !== filters.type)
          return false;
        return true;
      })
      .map((chunk) => ({ chunk, score: cosine(queryVector, chunk.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Insert or replace chunks by id. */
  async upsert(chunks: ChunkRecord[]): Promise<void> {
    for (const chunk of chunks) this.chunks.set(chunk.id, { ...chunk });
  }
}
