#!/usr/bin/env bun
/**
 * GitHub PR and issue events for this machine.
 *
 *   bun src/cli.ts poll        one poll; launchd runs this on the interval
 *   bun src/cli.ts install     write and load the launch agent
 *   bun src/cli.ts uninstall   unload and remove the launch agent
 *   bun src/cli.ts plist       print the launch agent without installing it
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { loadConfig, paths } from "./config";
import { fetchNodes, fetchOpen, token } from "./github";
import { LABEL, plist } from "./launchd";
import { runPoll, type Source } from "./poll";

const agentPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const logPath = join(homedir(), "Library", "Logs", "gh-events.log");

function launchAgent(): string {
  const gh = Bun.which("gh");
  if (!gh) throw new Error("gh is not on PATH");
  // Prefer a mise shim: the resolved install path carries the gh version and
  // breaks on the next upgrade.
  const shims = join(homedir(), ".local", "share", "mise", "shims");
  const ghDir = existsSync(join(shims, "gh")) ? shims : dirname(gh);
  // The bun on PATH is an unversioned link; process.execPath resolves to the
  // versioned install path, which a package-manager upgrade removes.
  return plist({
    bun: Bun.which("bun") ?? process.execPath,
    cli: import.meta.path,
    interval: loadConfig().intervalSeconds,
    log: logPath,
    path: [ghDir, "/usr/bin", "/bin"].join(":"),
  });
}

function launchctl(...args: string[]): number {
  return Bun.spawnSync(["launchctl", ...args], {
    stderr: "inherit",
    stdout: "inherit",
  }).exitCode;
}

/** Unloads the agent if it is loaded; a first install has nothing to unload. */
function bootout(): void {
  Bun.spawnSync(["launchctl", "bootout", `gui/${uid}/${LABEL}`], {
    stderr: "ignore",
    stdout: "ignore",
  });
}

async function poll(): Promise<number> {
  const config = loadConfig();
  const tokens = new Map<string, string>();
  const auth = (login: string): string => {
    const known = tokens.get(login);
    if (known) return known;
    const value = token(login);
    tokens.set(login, value);
    return value;
  };
  const source: Source = {
    nodes: (account, ids) => fetchNodes(account, auth(account.login), ids),
    open: (account) => fetchOpen(account, auth(account.login)),
  };
  const reports = await runPoll(config, source, {
    events: paths.events(),
    registry: paths.registry(),
    state: paths.state(),
  });
  const at = new Date().toISOString();
  for (const r of reports) {
    console.log(
      r.error
        ? `${at} ${r.login}: FAILED ${r.error}`
        : `${at} ${r.login}: ${r.open} open items, ${r.dropped} dropped by guard, ${r.cost} point(s), ${r.events} event(s)`,
    );
  }
  return reports.some((r) => r.error) ? 1 : 0;
}

const uid = String(process.getuid?.() ?? "");

switch (process.argv[2] ?? "poll") {
  case "install": {
    const xml = launchAgent();
    mkdirSync(dirname(agentPath), { recursive: true });
    mkdirSync(dirname(logPath), { recursive: true });
    bootout();
    writeFileSync(agentPath, xml);
    process.exit(launchctl("bootstrap", `gui/${uid}`, agentPath));
    break;
  }
  case "plist":
    console.log(launchAgent());
    break;
  case "poll":
    process.exit(await poll());
    break;
  case "uninstall":
    bootout();
    rmSync(agentPath, { force: true });
    break;
  default:
    console.error("Usage: bun src/cli.ts [poll|install|uninstall|plist]");
    process.exit(2);
}
