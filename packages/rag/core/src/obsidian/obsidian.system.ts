import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SourceFile } from "../model";
import type { ISourceReader } from "./interfaces";

/** Reads an Obsidian vault from disk. Thin wrapper — no business logic. */
export class VaultReader implements ISourceReader {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Recursively list markdown files with mtimes, relative to the vault root. */
  async listFiles(): Promise<SourceFile[]> {
    const files: SourceFile[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(join(dir, entry.name), relPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          const info = await stat(join(dir, entry.name));
          files.push({ modifiedAt: info.mtimeMs, relPath });
        }
      }
    };
    await walk(this.root, "");
    return files;
  }

  /** Read one file as UTF-8; null for empty or unreadable (evicted) content. */
  async readFile(relPath: string): Promise<string | null> {
    try {
      const content = await readFile(join(this.root, relPath), "utf8");
      return content.length === 0 ? null : content;
    } catch {
      return null;
    }
  }
}
