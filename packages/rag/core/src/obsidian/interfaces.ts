import type { SourceFile } from "../model";

/** Port for reading a source's files; implemented by the system layer. */
export interface ISourceReader {
  /** List every file under the source root with its modification time. */
  listFiles(): Promise<SourceFile[]>;
  /**
   * Read one file's content, or null when the content is unavailable (for
   * example an iCloud-evicted stub) — callers must skip, never index empty.
   */
  readFile(relPath: string): Promise<string | null>;
}
