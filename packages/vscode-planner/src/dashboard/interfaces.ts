/** Port interfaces for the dashboard domain. */

/** Reads the dashboard file. Implemented by the system layer. */
export interface IDashboardReader {
  /**
   * Read a file's contents.
   *
   * @param path - Absolute path to the file.
   * @returns The contents, or null when the file cannot be read.
   */
  read(path: string): string | null;
}
