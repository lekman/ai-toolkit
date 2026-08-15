/** Outcome of one scan run, written into scan reports and OQ evidence. */
export interface ScanReport {
  /** Total chunks in the store after the scan. */
  chunkCount: number;
  /** Chunks whose content changed and were re-embedded this run. */
  embedded: number;
  /** Files whose chunks were removed (deleted or renamed sources). */
  removedPaths: string[];
  /** Files skipped because their content was unavailable (evicted stubs). */
  skippedUnreadable: string[];
  /** Files scanned (eligible, non-excluded). */
  scannedFiles: number;
  /**
   * Files that actually wrote to the store this run. Each write is a store
   * version, so on a quiet reconcile this should be 0 and never the full
   * file count — a number close to `scannedFiles` means the index is
   * rewriting rows it already holds.
   */
  upsertedFiles: number;
}
