/** Filesystem adapter for the dashboard domain. */

import { readFileSync, statSync, writeFileSync } from "node:fs";

import type { IDashboardReader, IDashboardWriter } from "./interfaces.ts";

/** Reads the dashboard from disk. */
export class FileDashboardReader implements IDashboardReader, IDashboardWriter {
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

  /**
   * Overwrite a file's contents.
   *
   * @param path - Absolute path to the file.
   * @param contents - The full new contents.
   * @returns True when the write succeeded.
   */
  write(path: string, contents: string): boolean {
    try {
      writeFileSync(path, contents, "utf8");
      return true;
    } catch {
      return false;
    }
  }
}
