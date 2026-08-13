/** Trust tier a chunk belongs to. Derived at ingestion, enforced at serving. */
export type TierName = "private" | "private-business" | "shared-business";

/** A source file as seen by a reader: relative path plus modification time. */
export interface SourceFile {
  /** Path relative to the source root, forward-slash separated. */
  relPath: string;
  /** Last modification time, epoch milliseconds. */
  modifiedAt: number;
}

/** One retrievable chunk, the unit stored in every ChunkStore. */
export interface ChunkRecord {
  /** Stable ID: hash of source + relPath + headingPath + ordinal. */
  id: string;
  /** Source system name, e.g. "obsidian". */
  source: string;
  /** Trust tier derived at ingestion. */
  tier: TierName;
  /** Source-relative path of the originating file. */
  path: string;
  /** Human-readable context, e.g. "Note title › H2 › H3". */
  headingPath: string;
  /** Position of this chunk within its file, 0-based. */
  ordinal: number;
  /** The retrievable text. */
  text: string;
  /** SHA-256 of the chunk text; unchanged hash means no re-embed. */
  contentHash: string;
  /** Embedding vector; empty until the embed step runs. */
  embedding: number[];
  /** Source-specific metadata (frontmatter fields, tags, status). */
  metadata: Record<string, string>;
  /** Source file mtime, epoch milliseconds. */
  modifiedAt: number;
}

/** Filters accepted by ChunkStore.search. */
export interface SearchFilters {
  /** Restrict to one tier. */
  tier?: TierName;
  /** Restrict to one source system. */
  source?: string;
  /** Restrict to one metadata client value. */
  client?: string;
  /** Restrict to one metadata type value. */
  type?: string;
  /** Include chunks whose metadata status is "archived" (default false). */
  includeArchived?: boolean;
}

/** One search hit: the chunk plus its relevance score. */
export interface SearchResult {
  /** The matching chunk. */
  chunk: ChunkRecord;
  /** Store-specific relevance score; higher is more relevant. */
  score: number;
}
