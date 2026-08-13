/** Filesystem adapter for the dashboard domain. */

import { readFileSync, statSync } from "node:fs";

import type { IDashboardReader } from "./interfaces.ts";

/** Reads the dashboard from disk. */
export class FileDashboardReader implements IDashboardReader {
  /**
   * Last-modified time, used to poll for changes without re-parsing.
   *
   * @param path - Absolute path to the file.
   * @returns Milliseconds since the epoch, or null when the file is missing.
   */
  modifiedAt(path: string): null | number {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  }

  /**
   * Read a file's contents.
   *
   * @param path - Absolute path to the file.
   * @returns The contents, or null when the file cannot be read.
   */
  read(path: string): null | string {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }
}
