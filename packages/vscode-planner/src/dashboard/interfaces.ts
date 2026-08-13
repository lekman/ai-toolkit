/** Port interfaces for the dashboard domain. */

/** Reads the dashboard file. Implemented by the system layer. */
export interface IDashboardReader {
  /**
   * Last-modified time, used to poll for changes without re-parsing.
   *
   * @param path - Absolute path to the file.
   * @returns Milliseconds since the epoch, or null when the file is missing.
   */
  modifiedAt(path: string): null | number;

  /**
   * Read a file's contents.
   *
   * @param path - Absolute path to the file.
   * @returns The contents, or null when the file cannot be read.
   */
  read(path: string): null | string;
}
