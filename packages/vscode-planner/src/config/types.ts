/** Value types for configuration. */

/** Whether to print the client name above its tasks. */
export type ClientHeadingMode = "always" | "auto" | "never";

/** Everything the views need in order to render, plus why they cannot. */
export interface PlannerConfig {
  /** Client headings to show. Empty means show every client. */
  clients: string[];
  /** Absolute path to `Dashboard.md`, or null when it could not be resolved. */
  dashboardPath: string | null;
  /** Reason shown in the view when `dashboardPath` is null. */
  problem: string | null;
  showClientHeadings: ClientHeadingMode;
}

/** The extension's own settings, as read from VS Code. */
export interface PlannerSettings {
  clients: string[];
  dashboardPath: string;
  showClientHeadings: ClientHeadingMode;
}

/**
 * The parts of `~/.claude/obsidian.json` this extension uses.
 *
 * The same file backs the planner and obsidian Claude Code plugins, so a
 * repository already mapped there needs no extension settings at all.
 */
export interface SharedObsidianConfig {
  /** Absolute path prefix to client name. */
  clients?: Record<string, string>;
  /** Dashboard path, relative to `vault`. */
  dashboard?: string;
  /** Absolute path to the Obsidian vault. */
  vault?: string;
}
