/** A chunk produced by the chunker, before identity and storage concerns. */
export interface RawChunk {
  /** Human-readable context: note title plus heading trail. */
  headingPath: string;
  /** Position within the file, 0-based. */
  ordinal: number;
  /** Chunk text content. */
  text: string;
}
