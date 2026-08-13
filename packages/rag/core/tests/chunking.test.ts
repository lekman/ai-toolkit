import { describe, expect, test } from "bun:test";

import { Chunker, StableId } from "../src/chunking";

const NOTE = `Intro paragraph before any heading.

## Architecture

The system splits into three parts.

### Storage

LanceDB holds the chunks.

## Decisions

We chose the embedded store.
`;

describe("Chunker", () => {
  test("splits on H2/H3 and keeps the heading trail", () => {
    const chunks = Chunker.chunk(NOTE, "Design");
    expect(chunks.map((c) => c.headingPath)).toEqual([
      "Design",
      "Design › Architecture",
      "Design › Architecture › Storage",
      "Design › Decisions",
    ]);
    expect(chunks[2]?.text).toContain("LanceDB");
  });

  test("is deterministic: same input, same chunks, twice", () => {
    expect(Chunker.chunk(NOTE, "Design")).toEqual(
      Chunker.chunk(NOTE, "Design"),
    );
  });

  test("a note without headings is a single chunk", () => {
    const chunks = Chunker.chunk("Just a short thought.", "Idea");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBe("Idea");
  });

  test("headings inside code fences are not split points", () => {
    const md = "Text\n\n```md\n## not a heading\n```\n\nMore text";
    expect(Chunker.chunk(md, "Note")).toHaveLength(1);
  });

  test("empty sections are dropped", () => {
    const chunks = Chunker.chunk("## A\n\n## B\n\ncontent", "Note");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headingPath).toBe("Note › B");
  });
});

describe("StableId", () => {
  test("same tuple gives the same id; any part changes it", () => {
    const id = StableId.forChunk("obsidian", "a/b.md", "B › H", 0);
    expect(StableId.forChunk("obsidian", "a/b.md", "B › H", 0)).toBe(id);
    expect(StableId.forChunk("obsidian", "a/b.md", "B › H", 1)).not.toBe(id);
    expect(StableId.forChunk("obsidian", "a/c.md", "B › H", 0)).not.toBe(id);
  });

  test("content hash is stable and content-sensitive", () => {
    expect(StableId.contentHash("x")).toBe(StableId.contentHash("x"));
    expect(StableId.contentHash("x")).not.toBe(StableId.contentHash("y"));
  });
});
