/**
 * Where the Bedrock environment comes from.
 *
 * A repo-local `.claude/bedrock.env` wins over the one in your home directory,
 * so a project that must run on a specific account can pin it and every
 * contributor picks it up by being in the directory. Nothing is exported to
 * your shell — the file is read and handed to the child process only.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME_ENV_FILE = join(homedir(), ".claude", "bedrock.env");
export const REPO_ENV_FILE = join(".claude", "bedrock.env");

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

/**
 * Claude Code reads its Bedrock configuration from `~/.claude/settings.json`
 * when `/setup-bedrock` has run. Treat that as already-configured rather than
 * duplicating the wizard.
 */
export function settingsHasBedrock(): boolean {
  const settings = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settings)) return false;
  try {
    const parsed = JSON.parse(readFileSync(settings, "utf8")) as {
      env?: Record<string, string>;
    };
    return parsed.env?.CLAUDE_CODE_USE_BEDROCK === "1";
  } catch {
    return false;
  }
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
