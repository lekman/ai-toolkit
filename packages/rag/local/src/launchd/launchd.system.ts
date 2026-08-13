import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AgentPlist } from "./launchd";

const exec = promisify(execFile);

/** Writes and (re)loads launchd agents. Thin wrapper — no business logic. */
export class LaunchdInstaller {
  /** Write the plist into ~/Library/LaunchAgents and bootstrap it. */
  static async install(agent: AgentPlist): Promise<string> {
    const dir = join(homedir(), "Library/LaunchAgents");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${agent.label}.plist`);
    await writeFile(path, agent.xml);
    const uid = process.getuid?.() ?? 501;
    await exec("launchctl", ["bootout", `gui/${uid}`, path]).catch(
      () => undefined,
    );
    await exec("launchctl", ["bootstrap", `gui/${uid}`, path]);
    return path;
  }

  /** True when the label is currently loaded for this user. */
  static async isLoaded(label: string): Promise<boolean> {
    try {
      await exec("launchctl", ["list", label]);
      return true;
    } catch {
      return false;
    }
  }
}
