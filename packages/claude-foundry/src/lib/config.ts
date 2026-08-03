/**
 * Where the Microsoft Foundry environment comes from.
 *
 * A repo-local `.claude/foundry.env` wins over the one in your home directory,
 * so a project that must run against a specific Azure resource can pin it and
 * every contributor picks it up by being in the directory. Nothing is exported
 * to your shell — the file is read and handed to the child process only.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME_ENV_FILE = join(homedir(), ".claude", "foundry.env");
export const REPO_ENV_FILE = join(".claude", "foundry.env");
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
    if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
      // Double quotes carry backslash escapes, so a value containing a quote
      // survives being written and read back. This is the form written below.
      value = value.slice(1, -1).replace(/\\(.)/g, "$1");
    } else if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) {
      // Single quotes are literal in a shell, so nothing is unescaped here.
      value = value.slice(1, -1);
    }
    if (key) vars[key] = value;
  }
  return vars;
}

/** Read one env file by path. Empty when it does not exist. */
export function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
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
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ENABLE_PROMPT_CACHING_1H",
] as const;

/** Credentials. Handed to the child, never printed, never echoed back. */
export const SECRETS = [
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
] as const;

/**
 * Model pins worth warning about when missing.
 *
 * These three carry the aliases a session reaches without being asked: `opus`
 * and `sonnet` are the defaults, and `haiku` runs background work such as
 * session titles. Foundry verifies none of them before the first request.
 *
 * `ANTHROPIC_DEFAULT_FABLE_MODEL` is deliberately absent. That alias is only
 * used if someone types it, and few accounts deploy Fable, so warning about it
 * every run would be noise. It is still reported when set.
 */
export const MODEL_VARS = [
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];

/**
 * Variables that belong to this launcher rather than to your global settings.
 * Credentials are included: a key pinned globally reaches every session, which
 * is the same leak as the Foundry flag itself.
 */
const OWNED = new Set<string>([...REPORTED, ...SECRETS]);

/**
 * The subset that only ever means Foundry.
 *
 * `ANTHROPIC_DEFAULT_*_MODEL` and `ENABLE_PROMPT_CACHING_1H` are shared with
 * every other backend — Bedrock pins models through the same names. Seeing
 * them alone in settings.json says nothing about Foundry, so they are moved
 * only alongside one of these.
 */
const FOUNDRY_ONLY = new Set<string>([
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "CLAUDE_CODE_USE_FOUNDRY",
  ...SECRETS,
]);

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

/** Foundry variables left in global settings, if any. */
export function foundryVarsInSettings(): Record<string, string> {
  const env = readSettings()?.env ?? {};
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => OWNED.has(key)),
  );
}

/**
 * Write the shell-style form `parseEnvFile` reads back.
 *
 * Double quotes with backslash escapes, because the file is rewritten in place
 * — by `--setup` and by the settings migration — and a value has to survive
 * every round trip unchanged. Single quotes cannot express a single quote, so
 * a key containing one would grow a little more corrupt on each write.
 *
 * Mode 0600 because the file may hold an API key. That only applies when the
 * file is created; an existing file keeps whatever mode it has.
 */
export function writeEnvFile(
  path: string,
  vars: Record<string, string>,
  header: string[],
): void {
  const lines = [...header, ""];
  for (const [key, value] of Object.entries(vars)) {
    const escaped = value.replace(/(["\\$`])/g, "\\$1");
    lines.push(`export ${key}="${escaped}"`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
}

const MIGRATION_HEADER = [
  "# Read by @lekman/claude-foundry and handed to one child process.",
  "# Not exported to your shell, and not read by bare `claude`.",
  "#",
  "# Moved here from ~/.claude/settings.json, whose env block applies to",
  "# every session — including one launched by bare `claude`.",
];

export interface Migration {
  moved: string[];
  envFile: string;
}

/**
 * Move Foundry variables out of global settings and into the env file.
 *
 * Settings `env` applies to every session and outranks anything a parent
 * process exports. Foundry variables left there make this launcher pointless:
 * bare `claude` is on Foundry too, there is no way back to Claude.ai, and no
 * way to run the two side by side. So each run repairs it.
 *
 * Settings win on conflict — whoever edited them most recently had a reason.
 *
 * Model pins are only taken when a Foundry-specific variable sits beside them,
 * so a Bedrock setup that pins models in settings.json is left intact.
 *
 * Returns undefined when there is nothing to do, which is the normal case:
 * Foundry has no setup wizard, so variables only land in settings.json if
 * someone put them there by hand.
 */
export function migrateFromSettings(): Migration | undefined {
  const settings = readSettings();
  const owned = settings?.env
    ? Object.entries(settings.env).filter(([key]) => OWNED.has(key))
    : [];
  if (!settings?.env || owned.length === 0) return undefined;
  if (!owned.some(([key]) => FOUNDRY_ONLY.has(key))) return undefined;

  const existing = readEnvFile(HOME_ENV_FILE);
  writeEnvFile(
    HOME_ENV_FILE,
    { ...existing, ...Object.fromEntries(owned) },
    MIGRATION_HEADER,
  );

  for (const [key] of owned) delete settings.env[key];
  // An env block that only ever held Foundry variables should not survive as
  // an empty object.
  if (Object.keys(settings.env).length === 0) delete settings.env;
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);

  return { moved: owned.map(([key]) => key), envFile: HOME_ENV_FILE };
}
