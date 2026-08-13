import type { IEmbeddingsProvider } from "../embeddings";
import type { SearchFilters, SearchResult } from "../model";
import type { IChunkStore } from "../store";

import { OBSIDIAN_SOURCE } from "../obsidian";

/** A full note reassembled from its chunks. */
export interface DocumentResult {
  /** Frontmatter metadata from the note. */
  metadata: Record<string, string>;
  /** Vault-relative path. */
  path: string;
  /** Chunk texts joined in ordinal order. */
  text: string;
}

/**
 * The MCP tool surface's business logic: search, document reassembly, and
 * recency listing over a ChunkStore. Transport (stdio, HTTP) is the system
 * layer's concern; these methods are what both servers call.
 */
export class SearchHandlers {
  /** Reassemble one note from its stored chunks; null when not indexed. */
  static async getDocument(
    store: IChunkStore,
    path: string,
  ): Promise<DocumentResult | null> {
    const chunks = await store.readPath(OBSIDIAN_SOURCE, path);
    const first = chunks[0];
    if (!first) return null;
    return {
      metadata: first.metadata,
      path,
      text: chunks.map((chunk) => chunk.text).join("\n\n"),
    };
  }

  /** Most recently modified indexed notes: path, heading, modified time. */
  static async listRecent(
    store: IChunkStore,
    limit: number,
  ): Promise<{ modifiedAt: number; path: string }[]> {
    const paths = await store.listPaths(OBSIDIAN_SOURCE);
    const entries: { modifiedAt: number; path: string }[] = [];
    for (const path of paths) {
      const [first] = await store.readPath(OBSIDIAN_SOURCE, path);
      if (first) entries.push({ modifiedAt: first.modifiedAt, path });
    }
    return entries.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
  }

  /** Embed the query and search the store with filters. */
  static async search(
    store: IChunkStore,
    embeddings: IEmbeddingsProvider,
    query: string,
    filters: SearchFilters,
    limit: number,
  ): Promise<SearchResult[]> {
    const vector = await embeddings.embedQuery(query);
    return store.search(vector, filters, limit);
  }
}
