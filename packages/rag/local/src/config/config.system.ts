import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RagConfig } from "./types";

/** Default storage root for the local runtime. */
export const DEFAULT_STORAGE = join(homedir(), ".rag");

/** Reads and writes runtime config and env. Thin wrappers — no logic. */
export class ConfigStore {
  /** Load the config JSON from a storage root; null when absent. */
  static load(storageDir = DEFAULT_STORAGE): RagConfig | null {
    const path = join(storageDir, "config.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as RagConfig;
  }

  /**
   * Source KEY=VALUE lines from <storage>/env into process.env without
   * overriding variables that are already set.
   */
  static loadEnv(storageDir = DEFAULT_STORAGE): void {
    const path = join(storageDir, "env");
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const pair = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (
        pair?.[1] !== undefined &&
        pair[2] !== undefined &&
        process.env[pair[1]] === undefined
      ) {
        process.env[pair[1]] = pair[2].replace(/^["']|["']$/g, "");
      }
    }
  }

  /** Create the storage layout and persist the config JSON. */
  static async save(config: RagConfig): Promise<void> {
    await mkdir(join(config.storageDir, "data"), { recursive: true });
    await mkdir(join(config.storageDir, "qualification"), { recursive: true });
    await writeFile(
      join(config.storageDir, "config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
  }
}
