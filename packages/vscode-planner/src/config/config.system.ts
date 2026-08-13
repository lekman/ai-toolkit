/** VS Code and filesystem adapters for the config domain. */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

import type { IConfigSource } from "./interfaces.ts";
import type {
  ClientHeadingMode,
  PlannerSettings,
  SharedObsidianConfig,
} from "./types.ts";

/** Reads settings from VS Code and the shared config from the home directory. */
export class VscodeConfigSource implements IConfigSource {
  /**
   * Read `~/.claude/obsidian.json`.
   *
   * @returns The parsed config, or null when it is missing or unreadable.
   */
  readShared(): null | SharedObsidianConfig {
    try {
      return JSON.parse(
        readFileSync(this.sharedPath(), "utf8"),
      ) as SharedObsidianConfig;
    } catch {
      return null;
    }
  }

  /**
   * Read this extension's settings for the active workspace.
   *
   * @returns The settings, with VS Code's defaults already applied.
   */
  readSettings(): PlannerSettings {
    const settings = vscode.workspace.getConfiguration("planner");
    return {
      clients: settings.get<string[]>("clients", []),
      dashboardPath: settings.get<string>("dashboardPath", ""),
      showClientHeadings: settings.get<ClientHeadingMode>(
        "showClientHeadings",
        "auto",
      ),
    };
  }

  /**
   * Path of the shared config, used in error messages.
   *
   * @returns An absolute path.
   */
  sharedPath(): string {
    return join(homedir(), ".claude", "obsidian.json");
  }

  /**
   * The first workspace folder, used to derive the client.
   *
   * @returns An absolute path, or undefined when no folder is open.
   */
  workspaceFolder(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}
