#!/usr/bin/env bun
/**
 * install — copy the plugin into an Obsidian vault and enable it.
 *
 * The vault comes from `~/.claude/obsidian.json`, the same file the planner
 * scripts read, so one machine has one answer for where the vault is.
 *
 * Settings are not touched. `data.json` holds the operator's view, collapsed
 * rows and paths; it is per-machine and never shipped.
 *
 * Usage:
 *   bun scripts/install.ts                    # into the configured vault
 *   bun scripts/install.ts --vault <path>     # into a vault by path
 *   bun scripts/install.ts --dry-run
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PLUGIN_ID = "dashboard-kanban";
const FILES = ["main.js", "manifest.json", "styles.css", "README.md"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function fail(message: string): never {
  process.stderr.write(`install: ${message}\n`);
  process.exit(1);
}

function resolveVault(): string {
  const flag = args.indexOf("--vault");
  if (flag !== -1) {
    const given = args[flag + 1];
    if (!given) fail("--vault needs a path");
    return given;
  }
  const configPath = join(homedir(), ".claude", "obsidian.json");
  if (!existsSync(configPath))
    fail(`no ${configPath}; pass --vault <path> instead`);
  try {
    const { vault } = JSON.parse(readFileSync(configPath, "utf8"));
    if (!vault) fail(`${configPath} has no "vault" key`);
    return vault;
  } catch (e) {
    fail(`cannot read ${configPath}: ${(e as Error).message}`);
  }
}

const vault = resolveVault();
if (!existsSync(join(vault, ".obsidian")))
  fail(`${vault} does not look like a vault: no .obsidian folder`);

const source = dirname(import.meta.dir);
const target = join(vault, ".obsidian", "plugins", PLUGIN_ID);

for (const file of FILES) {
  if (!existsSync(join(source, file))) fail(`missing ${file} in ${source}`);
}

if (!dryRun) mkdirSync(target, { recursive: true });
for (const file of FILES) {
  if (!dryRun) copyFileSync(join(source, file), join(target, file));
}

// Obsidian reads this list on load; a plugin absent from it stays dormant.
const enabledPath = join(vault, ".obsidian", "community-plugins.json");
let enabled: string[];
try {
  enabled = JSON.parse(readFileSync(enabledPath, "utf8"));
} catch {
  enabled = [];
}
const alreadyEnabled = enabled.includes(PLUGIN_ID);
if (!alreadyEnabled && !dryRun) {
  enabled.push(PLUGIN_ID);
  writeFileSync(enabledPath, `${JSON.stringify(enabled, null, 2)}\n`, "utf8");
}

process.stdout.write(
  `${dryRun ? "DRY RUN " : ""}installed ${PLUGIN_ID} -> ${target}\n` +
    `  files: ${FILES.join(", ")}\n` +
    `  enabled: ${alreadyEnabled ? "already listed" : "added to community-plugins.json"}\n` +
    `  next: reload Obsidian, then set the ai-toolkit folder in the plugin's settings if it is not ~/Repo/ai-toolkit\n`,
);
