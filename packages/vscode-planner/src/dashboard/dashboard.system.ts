/** Filesystem adapter for the dashboard domain. */

import { readFileSync } from "node:fs";

import type { IDashboardReader } from "./interfaces.ts";

/** Reads the dashboard from disk. */
export class FileDashboardReader implements IDashboardReader {
  /**
   * Read a file's contents.
   *
   * @param path - Absolute path to the file.
   * @returns The contents, or null when the file cannot be read.
   */
  read(path: string): string | null {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }
}
