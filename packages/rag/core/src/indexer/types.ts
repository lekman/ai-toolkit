/** Outcome of one scan run, written into scan reports and OQ evidence. */
export interface ScanReport {
  /** Total chunks in the store after the scan. */
  chunkCount: number;
  /** Chunks whose content changed and were re-embedded this run. */
  embedded: number;
  /** Files whose chunks were removed (deleted or renamed sources). */
  removedPaths: string[];
  /**
   * Files that read fine but produced no chunks — an empty note, a
   * frontmatter-only stub, or a truncated read.
   *
   * Without this they were accounted for nowhere: not scanned, not skipped,
   * not removed, just absent from a report that looked complete. A note that
   * was never indexed is invisible; one that *was* indexed and stops yielding
   * falls out of `seenPaths` and surfaces as a `removedPaths` entry, which
   * reads as "the note was deleted" when the note is sitting right there.
   */
  skippedNoChunks: string[];
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
  /**
   * Set when reconcile REFUSED to delete. Nothing was removed; the index is
   * intact and stale rather than reconciled. Present only on refusal, so
   * `report.refusedRemoval` is the whole check.
   *
   * A reconcile trusts the file list to describe the vault. When the vault
   * path is wrong — repointed, unmounted, or being deleted underneath the
   * scanner — the list is honestly empty and the reconcile faithfully
   * destroys the index. Being stale is recoverable; being empty is not.
   */
  refusedRemoval?: {
    /** Paths currently in the index. */
    indexedPaths: number;
    /** Why the removal was refused, for the log line and the operator. */
    reason: "vault-empty" | "mass-removal";
    /** How many paths the reconcile would have deleted. */
    wouldRemove: number;
  };
}
