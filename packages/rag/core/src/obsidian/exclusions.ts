import type { ExclusionReason } from "./types";

/**
 * Decides which vault paths never reach the index: system folders, scratch
 * folders, templates, volatile task state, sync conflict/backup copies, and
 * the phase-1 health deferral. Pure — path string in, verdict out.
 */
export class Exclusions {
  /**
   * Return the exclusion reason for a vault-relative path, or null when the
   * path is eligible for indexing. Only markdown files are eligible.
   */
  static check(relPath: string): ExclusionReason | null {
    const segments = relPath.split("/");
    const name = segments[segments.length - 1] ?? relPath;

    if (!name.endsWith(".md")) return "system";
    if (
      segments.some(
        (s) =>
          s === ".obsidian" ||
          s === ".claude" ||
          s === ".tmp" ||
          s === "_Attachments" ||
          // Excluded from Obsidian Sync too, so these are single-machine
          // scratch: drafts in progress and qualification run output. Neither
          // is source material, and indexing them means a half-written note
          // can outrank the finished one it becomes.
          s === "_Drafts" ||
          s === "_OQ",
      )
    )
      return "system";
    if (name === "CLAUDE.md" || name === "_claude-context.md") return "system";
    if (segments[0] === "Templates") return "templates";
    if (
      name === "Dashboard.md" ||
      name === "Parked.md" ||
      /^Dashboard[ .]/.test(name) ||
      name.endsWith(" — Master Plan.md")
    )
      return "volatile";
    // name is a basename, so it holds no "/" and the old /\.bak[^/]*$/
    // scanned for ".bak" from every position — quadratic, and measurably
    // so. A plain substring test is linear and, on a basename, means
    // exactly the same thing. The ".bak-" arm it replaces was a subset.
    if (name.includes(".bak")) return "backup";
    // A sync conflict appends a small counter: "Note 2.md". The bound matters.
    // An unbounded \d+ also matches a trailing year, so every note whose title
    // ends in one — "Budget 2026.md", and every file following the
    // "<topic>, <Day> <D> <Mon> <YYYY>.md" handover convention — was excluded
    // as a phantom conflict copy and never reached the index. Two digits keeps
    // real conflict copies out and stops a four-digit year looking like one.
    // A conflict copy *of* a dated note still ends in the counter, so it is
    // still caught.
    if (/ \d{1,2}\.md$/.test(name) || / \(conflict\)/i.test(name))
      return "conflict-copy";
    if (segments[0] === "Personal" && segments[1] === "Health")
      return "health-deferred";
    return null;
  }

  /**
   * Decide whether a filesystem event on this path should trigger a
   * reconcile scan. Conservative: only a path that is recognisably an
   * excluded *file* or the vault root itself suppresses the scan —
   * everything uncertain scans.
   *
   * - `null` filename (fs.watch on macOS can omit it) → scan
   * - `""` = the watched root itself — iCloud touches the root directory's
   *   metadata ~2s after every file write (observed: a root-basename event
   *   followed each Dashboard.md write), so this fires for excluded files
   *   too and carries no signal of its own → skip
   * - last segment without a dot → could be a directory rename, whose
   *   children may be eligible but get no events of their own → scan
   * - eligible file → scan; excluded file → skip
   *
   * The daily full scan remains the backstop for anything this misses.
   */
  static shouldTriggerScan(relPath: string | null): boolean {
    if (relPath === null) return true;
    if (relPath === "") return false;
    const segments = relPath.split("/");
    const name = segments[segments.length - 1] ?? relPath;
    if (!name.includes(".")) return true;
    return Exclusions.check(relPath) === null;
  }
}
