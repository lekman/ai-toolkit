import type { ChunkRecord } from "../model";

import { Chunker, StableId } from "../chunking";
import { Exclusions } from "./exclusions";
import { Frontmatter } from "./frontmatter";
import { TierMap } from "./tiers";

/** Source name recorded on every chunk this adapter produces. */
export const OBSIDIAN_SOURCE = "obsidian";

/**
 * The Obsidian source adapter's business logic: turn one vault file into its
 * chunk records. Exclusion, frontmatter, chunking, tiering, and identity are
 * composed here; reading files is the system layer's job.
 */
export class ObsidianSource {
  /**
   * Build chunk records for one vault file. Returns an empty array for
   * excluded paths, so callers can map over any file list safely. Embeddings
   * are left empty; the indexer fills them for changed chunks only.
   */
  static toRecords(
    relPath: string,
    content: string,
    modifiedAt: number,
  ): ChunkRecord[] {
    if (Exclusions.check(relPath) !== null) return [];

    const { attrs, body } = Frontmatter.parse(content);
    const title = (relPath.split("/").pop() ?? relPath).replace(/\.md$/, "");
    const tier = TierMap.derive(relPath);

    return Chunker.chunk(body, title).map((chunk) => ({
      contentHash: StableId.contentHash(chunk.text),
      embedding: [],
      headingPath: chunk.headingPath,
      id: StableId.forChunk(
        OBSIDIAN_SOURCE,
        relPath,
        chunk.headingPath,
        chunk.ordinal,
      ),
      metadata: attrs,
      modifiedAt,
      ordinal: chunk.ordinal,
      path: relPath,
      source: OBSIDIAN_SOURCE,
      text: chunk.text,
      tier,
    }));
  }
}
