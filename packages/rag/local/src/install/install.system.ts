import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  writeFile,
} from "node:fs/promises";
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

  /**
   * A private copy of the Node binary for the agents to run under.
   *
   * macOS gates access to the iCloud-synced vault through TCC, and a process
   * spawned by launchd does not inherit the Full Disk Access granted to the
   * terminal. Something has to hold that grant. Granting it to the shared
   * interpreter would extend full disk access to every script any launchd
   * agent runs under it, which is far wider than this tool needs.
   *
   * So the agents run under their own copy, re-signed ad-hoc to give it a code
   * identity distinct from the original. The operator then grants Full Disk
   * Access to this one binary, and the shared interpreter stays ungranted.
   *
   * Best effort: if the copy or the signing fails, the caller falls back to
   * the running interpreter and the operator makes the wider grant knowingly.
   */
  static async prepareInterpreter(storageDir: string): Promise<string> {
    const binDir = join(storageDir, "bin");
    const target = join(binDir, "node");
    try {
      await mkdir(binDir, { recursive: true });
      await copyFile(process.execPath, target);
      await chmod(target, 0o755);
      // Ad-hoc signature: replaces the inherited one so TCC sees a separate
      // identity rather than treating this as the same binary it was copied
      // from. Without this the grant could apply to both.
      await exec("codesign", ["--force", "--sign", "-", target]);
      return target;
    } catch {
      return process.execPath;
    }
  }

  /** Install and bootstrap both launchd agents for this CLI build. */
  static async installAgents(
    cliPath: string,
    storageDir: string,
    withServer = false,
  ): Promise<string[]> {
    const logDir = join(storageDir, "logs");
    const node = await Installer.prepareInterpreter(storageDir);
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
