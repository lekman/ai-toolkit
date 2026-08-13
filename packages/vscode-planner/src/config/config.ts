/**
 * Where the dashboard lives, and which clients this workspace cares about.
 *
 * Both answers default to `~/.claude/obsidian.json`, the file the planner and
 * obsidian Claude Code plugins already read. That file maps repository paths
 * to client names, so a repository normally needs no extension settings at
 * all — opening it is enough to filter the view to its own client.
 */

import { join } from "node:path";

import type { IConfigSource } from "./interfaces.ts";
import type {
  PlannerConfig,
  PlannerSettings,
  SharedObsidianConfig,
} from "./types.ts";

/** Derives the effective configuration from settings and the shared config. */
export class Config {
  /**
   * Resolve a client name from a path, by longest prefix match.
   *
   * This is the rule `resolve-context.ts` uses, so the extension and the
   * planner skills agree on which client a repository belongs to.
   *
   * @param clients - The `clients` map: absolute path prefix to client name.
   * @param path - The workspace folder path.
   * @returns The matched client name, or null.
   */
  static clientForPath(
    clients: Record<string, string> | undefined,
    path: string | undefined,
  ): null | string {
    if (!clients || !path) return null;
    const matches = Object.entries(clients)
      .filter(([prefix]) => path === prefix || path.startsWith(prefix + "/"))
      .sort((a, b) => b[0].length - a[0].length);
    return matches[0]?.[1] ?? null;
  }

  /**
   * Build the effective configuration.
   *
   * `planner.dashboardPath` and `planner.clients` win when set. Otherwise the
   * dashboard comes from `vault` + `dashboard` in the shared config, and the
   * client from that file's `clients` path map. When neither yields a client,
   * every client is shown rather than none — an empty sidebar would look like
   * an empty day.
   *
   * @param settings - This extension's settings.
   * @param shared - The parsed shared config, or null.
   * @param workspaceFolder - The open folder, used to derive the client.
   * @param sharedPath - Path of the shared config, quoted in error messages.
   * @returns The resolved configuration.
   */
  static resolve(
    settings: PlannerSettings,
    shared: null | SharedObsidianConfig,
    workspaceFolder: string | undefined,
    sharedPath: string,
  ): PlannerConfig {
    const configured = settings.dashboardPath.trim();
    const configuredClients = settings.clients
      .map((c) => c.trim())
      .filter(Boolean);

    let dashboardPath: null | string = null;
    let problem: null | string = null;
    if (configured) {
      dashboardPath = configured;
    } else if (shared?.vault && shared.dashboard) {
      dashboardPath = join(shared.vault, shared.dashboard);
    } else {
      problem = shared
        ? `${sharedPath} has no "vault" and "dashboard" entries. Set planner.dashboardPath instead.`
        : `Could not read ${sharedPath}. Set planner.dashboardPath to your Dashboard.md.`;
    }

    let clients = configuredClients;
    if (clients.length === 0) {
      const derived = Config.clientForPath(shared?.clients, workspaceFolder);
      if (derived) clients = [derived];
    }

    return {
      clients,
      dashboardPath,
      pollSeconds: Math.max(0, settings.pollSeconds),
      problem,
      showClientHeadings: settings.showClientHeadings,
      showCompleted: settings.showCompleted,
    };
  }

  /**
   * Read every input from a source and resolve it.
   *
   * @param source - The adapter supplying settings and the shared config.
   * @returns The resolved configuration.
   */
  static load(source: IConfigSource): PlannerConfig {
    return Config.resolve(
      source.readSettings(),
      source.readShared(),
      source.workspaceFolder(),
      source.sharedPath(),
    );
  }
}
