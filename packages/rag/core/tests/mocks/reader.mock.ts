import type { SourceFile } from "../../src/model";
import type { ISourceReader } from "../../src/obsidian";

/** In-memory source reader: path → content, null simulating evicted files. */
export class ReaderMock implements ISourceReader {
  /** Backing map: relPath → content (null = evicted) + mtime. */
  readonly files = new Map<
    string,
    { content: string | null; modifiedAt: number }
  >();

  /** Set or replace a file in the fake source. */
  set(relPath: string, content: string | null, modifiedAt = 1_000): void {
    this.files.set(relPath, { content, modifiedAt });
  }

  /** List the fake source's files. */
  async listFiles(): Promise<SourceFile[]> {
    return [...this.files.entries()].map(([relPath, file]) => ({
      modifiedAt: file.modifiedAt,
      relPath,
    }));
  }

  /** Read a fake file; null simulates evicted content. */
  async readFile(relPath: string): Promise<string | null> {
    return this.files.get(relPath)?.content ?? null;
  }
}
