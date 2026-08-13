import type { ExclusionReason } from "./types";

/**
 * Decides which vault paths never reach the index: system folders,
 * templates, volatile task state, iCloud conflict/backup copies, and the
 * phase-1 health deferral. Pure — path string in, verdict out.
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
          s === "_Attachments",
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
    if (/\.bak[^/]*$/.test(name) || name.includes(".bak-")) return "backup";
    if (/ \d+\.md$/.test(name) || / \(conflict\)/i.test(name))
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
