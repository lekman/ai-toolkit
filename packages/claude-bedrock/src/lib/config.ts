/**
 * Where the Bedrock environment comes from.
 *
 * A repo-local `.claude/bedrock.env` wins over the one in your home directory,
 * so a project that must run on a specific account can pin it and every
 * contributor picks it up by being in the directory. Nothing is exported to
 * your shell — the file is read and handed to the child process only.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME_ENV_FILE = join(homedir(), ".claude", "bedrock.env");
export const REPO_ENV_FILE = join(".claude", "bedrock.env");
export const SETTINGS_FILE = join(homedir(), ".claude", "settings.json");

export interface EnvFile {
  path: string;
  vars: Record<string, string>;
}

/**
 * Parse a shell-style env file. Handles `export KEY=value`, plain `KEY=value`,
 * quoted values, and `#` comments. Deliberately not a shell — an env file that
 * needs command substitution is doing too much.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of contents.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line
      .replace(/^export\s+/, "")
      .match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = (rawValue ?? "").trim();
    // Strip one layer of matching quotes; leave inner quotes alone.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

/** Repo-local file if present, otherwise the home one. Undefined if neither. */
export function findEnvFile(cwd = process.cwd()): EnvFile | undefined {
  for (const path of [join(cwd, REPO_ENV_FILE), HOME_ENV_FILE]) {
    if (existsSync(path)) {
      return { path, vars: parseEnvFile(readFileSync(path, "utf8")) };
    }
  }
  return undefined;
}

/** The variable names worth reporting in `--status`. Secrets are never among them. */
export const REPORTED = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_MANTLE",
  "AWS_REGION",
  "AWS_PROFILE",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_BEDROCK_SERVICE_TIER",
] as const;

/**
 * Variables that belong to this launcher rather than to your global settings.
 * `AWS_*` is included: a profile pinned globally is applied to every session,
 * which is the same leak as the Bedrock flag itself.
 */
const OWNED = new Set<string>([...REPORTED, "AWS_BEARER_TOKEN_BEDROCK"]);

interface Settings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

function readSettings(): Settings | undefined {
  if (!existsSync(SETTINGS_FILE)) return undefined;
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Settings;
  } catch {
    // A settings file we cannot parse is not ours to rewrite.
    return undefined;
  }
}

/** Bedrock variables `/setup-bedrock` left in global settings, if any. */
export function bedrockVarsInSettings(): Record<string, string> {
  const env = readSettings()?.env ?? {};
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => OWNED.has(key)),
  );
}

/** Serialise to the shell-style form `parseEnvFile` reads back. */
function formatEnvFile(vars: Record<string, string>): string {
  const lines = [
    "# Read by @lekman/claude-bedrock and handed to one child process.",
    "# Not exported to your shell, and not read by bare `claude`.",
    "#",
    "# Moved here from ~/.claude/settings.json, where /setup-bedrock writes it.",
    "# Re-run `claude-bedrock` after `/setup-bedrock` to pick up new values.",
    "",
  ];
  for (const [key, value] of Object.entries(vars)) {
    lines.push(`export ${key}='${value.replace(/'/g, "'\\''")}'`);
  }
  return `${lines.join("\n")}\n`;
}

export interface Migration {
  moved: string[];
  envFile: string;
}

/**
 * Move Bedrock variables out of global settings and into the env file.
 *
 * `/setup-bedrock` writes to `~/.claude/settings.json`, and settings `env`
 * applies to every session — including one launched by bare `claude`, and it
 * outranks anything a parent process exports. Left alone it makes this launcher
 * pointless: there is no way back to Claude.ai, and no way to run the two side
 * by side. So each run repairs it.
 *
 * Settings win on conflict. Someone who just ran the wizard has the fresher
 * values, and those are the ones their account can actually invoke.
 *
 * Returns undefined when there is nothing to do, which is the normal case.
 */
export function migrateFromSettings(): Migration | undefined {
  const settings = readSettings();
  const owned = settings?.env
    ? Object.entries(settings.env).filter(([key]) => OWNED.has(key))
    : [];
  if (!settings?.env || owned.length === 0) return undefined;

  const existing = existsSync(HOME_ENV_FILE)
    ? parseEnvFile(readFileSync(HOME_ENV_FILE, "utf8"))
    : {};
  writeFileSync(
    HOME_ENV_FILE,
    formatEnvFile({ ...existing, ...Object.fromEntries(owned) }),
    { mode: 0o600 },
  );

  for (const [key] of owned) delete settings.env[key];
  // An env block that only ever held Bedrock variables should not survive as
  // an empty object.
  if (Object.keys(settings.env).length === 0) delete settings.env;
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);

  return { moved: owned.map(([key]) => key), envFile: HOME_ENV_FILE };
}
