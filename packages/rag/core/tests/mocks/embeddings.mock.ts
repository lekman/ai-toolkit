import type { IEmbeddingsProvider } from "../../src/embeddings";

import { StableId } from "../../src/chunking";

/**
 * Deterministic embeddings for tests: 8-dim vectors derived from the text's
 * content hash. Identical text → identical vector; no network.
 */
export class EmbeddingsMock implements IEmbeddingsProvider {
  /** Fixed test vector length. */
  readonly dimensions = 8;
  /** Number of embed() texts processed, for asserting incremental behavior. */
  embeddedCount = 0;

  /** Deterministic batch embedding; counts processed texts. */
  async embed(texts: string[]): Promise<number[][]> {
    this.embeddedCount += texts.length;
    return texts.map((text) => EmbeddingsMock.vector(text));
  }

  /** Deterministic query embedding. */
  async embedQuery(text: string): Promise<number[]> {
    return EmbeddingsMock.vector(text);
  }

  private static vector(text: string): number[] {
    const hash = StableId.contentHash(text);
    return Array.from(
      { length: 8 },
      (_, i) => parseInt(hash.slice(i * 2, i * 2 + 2), 16) / 255,
    );
  }
}
