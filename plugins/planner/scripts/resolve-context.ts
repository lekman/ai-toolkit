#!/usr/bin/env bun
/**
 * resolve-context — silent cwd→client resolver for planner skills.
 *
 * Prints exactly one line of JSON and nothing else:
 *   {"client":"Acme","vault":"/path/to/vault","plans":"Clients/Acme/Initiatives",
 *    "plansDir":"/abs/path","tracker":"jira","jira":{"host":"…","project":"…"},
 *    "regulatory":["GxP"]}
 *
 * Resolution: longest path-prefix match of --cwd (default: process.cwd())
 * against the `clients` map in ~/.claude/obsidian.json; `--client X`
 * overrides. Falls back to `default_client` when nothing matches (exit 0).
 * Missing planner block for the resolved client is an error (exit 1) — the
 * skills need to know where plans live.
 *
 * `regulatory` comes from the top-level `regulatory` map, keyed by client. It
 * is always present, `[]` for an unregulated client, so a caller can branch on
 * it without distinguishing "not regulated" from "not configured".
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface PlannerEntry {
  plans: string;
  tracker: "jira" | "github" | "none";
  jira?: { host: string; project: string };
}

interface ObsidianConfig {
  vault: string;
  dashboard: string;
  clients?: Record<string, string>;
  default_client?: string;
  planner?: Record<string, PlannerEntry>;
  /** Client name → regulatory standards that govern its work, e.g. ["GxP"]. */
  regulatory?: Record<string, string[]>;
}

function fail(message: string): never {
  process.stderr.write(`resolve-context: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
let cwd = process.cwd();
let clientOverride: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cwd" && args[i + 1]) cwd = args[++i];
  else if (args[i] === "--client" && args[i + 1]) clientOverride = args[++i];
}

const configPath = join(homedir(), ".claude", "obsidian.json");
let config: ObsidianConfig;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (e) {
  fail(`cannot read ${configPath}: ${(e as Error).message}`);
}

let client = clientOverride;
if (!client) {
  const matches = Object.entries(config.clients ?? {})
    .filter(([prefix]) => cwd === prefix || cwd.startsWith(prefix + "/"))
    .sort((a, b) => b[0].length - a[0].length);
  client = matches[0]?.[1] ?? config.default_client;
}
if (!client) fail("no client resolved and no default_client configured");

const planner = config.planner?.[client];
if (!planner)
  fail(
    `no planner block for client "${client}" in ${configPath} — add planner.${JSON.stringify(client)} with {plans, tracker}`,
  );

process.stdout.write(
  JSON.stringify({
    client,
    vault: config.vault,
    plans: planner.plans,
    plansDir: join(config.vault, planner.plans),
    tracker: planner.tracker,
    ...(planner.jira ? { jira: planner.jira } : {}),
    regulatory: config.regulatory?.[client] ?? [],
  }) + "\n",
);
