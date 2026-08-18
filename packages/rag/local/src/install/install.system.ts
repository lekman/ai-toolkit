import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RagConfig } from "../config";

import { Config, ConfigStore } from "../config";
import { Launchd, LaunchdInstaller } from "../launchd";

const exec = promisify(execFile);

/** Executes the install flow. Thin wrappers — decisions live in the CLI. */
export class Installer {
  /** Best-effort vault autodetection from ~/.claude/obsidian.json. */
  static detectVault(): string | null {
    const configPath = join(homedir(), ".claude/obsidian.json");
    if (!existsSync(configPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
        vault?: string;
      };
      return parsed.vault && existsSync(parsed.vault) ? parsed.vault : null;
    } catch {
      return null;
    }
  }

  /** Create storage, persist config, and seed the env file if absent. */
  static async prepareStorage(
    vaultPath: string,
    storageDir: string,
  ): Promise<RagConfig> {
    const config = Config.build(vaultPath, storageDir);
    await ConfigStore.save(config);
    await mkdir(join(storageDir, "logs"), { recursive: true });
    const envPath = join(storageDir, "env");
    if (!existsSync(envPath)) {
      await writeFile(envPath, "", { mode: 0o600 });
      await appendFile(envPath, "# VOYAGE_API_KEY=paste-your-key-here\n");
    }
    return config;
  }

  /** Install and bootstrap both launchd agents for this CLI build. */
  static async installAgents(
    cliPath: string,
    storageDir: string,
    withServer = false,
  ): Promise<string[]> {
    const logDir = join(storageDir, "logs");
    const node = process.execPath;
    const paths: string[] = [];
    paths.push(
      await LaunchdInstaller.install(Launchd.watchAgent(node, cliPath, logDir)),
    );
    paths.push(
      await LaunchdInstaller.install(Launchd.scanAgent(node, cliPath, logDir)),
    );
    if (withServer) {
      paths.push(
        await LaunchdInstaller.install(
          Launchd.serverAgent(node, cliPath, logDir),
        ),
      );
    }
    return paths;
  }

  /** Register the MCP server with Claude Code (user scope, idempotent). */
  static async registerMcp(cliPath: string): Promise<boolean> {
    await exec("claude", ["mcp", "remove", "--scope", "user", "rag"]).catch(
      () => undefined,
    );
    return exec("claude", [
      "mcp",
      "add",
      "--scope",
      "user",
      "rag",
      "--",
      process.execPath,
      cliPath,
      "mcp",
    ]).then(
      () => true,
      () => false,
    );
  }
}
