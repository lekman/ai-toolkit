/** Port for turning text into vectors; implemented by the system layer. */
export interface IEmbeddingsProvider {
  /** Vector length this provider produces; stores size columns from it. */
  readonly dimensions: number;
  /** Embed a batch of texts for indexing; one vector per input, same order. */
  embed(texts: string[]): Promise<number[][]>;
  /** Embed a search query (providers may use a query-specific mode). */
  embedQuery(text: string): Promise<number[]>;
}
