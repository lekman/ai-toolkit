/** Port interfaces for the config domain. */

import type { PlannerSettings, SharedObsidianConfig } from "./types.ts";

/** Supplies the raw inputs configuration is derived from. */
export interface IConfigSource {
  /**
   * Read `~/.claude/obsidian.json`.
   *
   * @returns The parsed config, or null when it is missing or unreadable.
   */
  readShared(): SharedObsidianConfig | null;

  /**
   * Read this extension's settings for the active workspace.
   *
   * @returns The settings, with VS Code's defaults already applied.
   */
  readSettings(): PlannerSettings;

  /**
   * Path of the shared config, used in error messages.
   *
   * @returns An absolute path.
   */
  sharedPath(): string;

  /**
   * The first workspace folder, used to derive the client.
   *
   * @returns An absolute path, or undefined when no folder is open.
   */
  workspaceFolder(): string | undefined;
}
