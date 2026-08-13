import type { RawChunk } from "./types";

/**
 * Splits markdown into retrievable chunks along H2/H3 headings, keeping the
 * heading trail in each chunk so retrieved text carries its context. Pure:
 * same input always produces the same chunks in the same order.
 */
export class Chunker {
  /**
   * Split a markdown body into chunks. Content before the first H2 becomes
   * the first chunk. Files without headings produce a single chunk. Empty
   * or whitespace-only sections are dropped.
   */
  static chunk(markdown: string, title: string): RawChunk[] {
    const lines = markdown.split("\n");
    const sections: { text: string[]; trail: string[] }[] = [
      { text: [], trail: [] },
    ];
    let currentH2: string | undefined;
    let inFence = false;

    for (const line of lines) {
      if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
      const h2 = !inFence ? /^##\s+(.*)$/.exec(line) : null;
      const h3 = !inFence ? /^###\s+(.*)$/.exec(line) : null;
      if (h3?.[1] !== undefined) {
        sections.push({
          text: [],
          trail:
            currentH2 !== undefined
              ? [currentH2, h3[1].trim()]
              : [h3[1].trim()],
        });
      } else if (h2?.[1] !== undefined) {
        currentH2 = h2[1].trim();
        sections.push({ text: [], trail: [currentH2] });
      } else {
        const current = sections[sections.length - 1];
        if (current) current.text.push(line);
      }
    }

    const chunks: RawChunk[] = [];
    for (const section of sections) {
      const text = section.text.join("\n").trim();
      if (text.length === 0) continue;
      chunks.push({
        headingPath: [title, ...section.trail].join(" › "),
        ordinal: chunks.length,
        text,
      });
    }
    return chunks;
  }
}
