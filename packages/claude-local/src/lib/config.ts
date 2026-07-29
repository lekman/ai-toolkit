/**
 * Persisted state: which model is current, which port serves it.
 *
 * The environment variables that point Claude Code at localhost are built from
 * this and handed to the child process at launch. They are never exported into
 * your shell, and no wrapper script is written to disk. A stray
 * ANTHROPIC_BASE_URL in a shell profile would silently send every ordinary
 * `claude` session to the weaker local model, and you would notice it as
 * confusing quality rather than as an error — so `claude-local` is local and
 * `claude` stays untouched.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CONFIG_FILE = join(homedir(), ".claude", "claude-local.json");
export const DEFAULT_PORT = 1234;

export interface Config {
  port: number;
  mainModel: string;
  backgroundModel: string;
  context: number;
}

/** Read the persisted config; undefined when missing, incomplete, or corrupt. */
export function readConfig(): Config | undefined {
  if (!existsSync(CONFIG_FILE)) return undefined;
  try {
    const parsed = JSON.parse(
      readFileSync(CONFIG_FILE, "utf8"),
    ) as Partial<Config>;
    if (!parsed.mainModel) return undefined;
    return {
      port: parsed.port ?? DEFAULT_PORT,
      mainModel: parsed.mainModel,
      backgroundModel: parsed.backgroundModel ?? parsed.mainModel,
      context: parsed.context ?? 65536,
    };
  } catch {
    // A corrupt config is treated as no config: setup will rewrite it.
    return undefined;
  }
}

/** Write the config, creating ~/.claude on first use. */
export function writeConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Merge a patch into the existing config; undefined when setup has not run. */
export function updateConfig(patch: Partial<Config>): Config | undefined {
  const current = readConfig();
  if (!current) return undefined;
  const next = { ...current, ...patch };
  writeConfig(next);
  return next;
}

/**
 * The variables Claude Code needs to talk to LM Studio instead of the hosted
 * API. Opus and Sonnet both map to the loaded model so that switching models
 * inside a session does not silently fail.
 */
export function claudeEnv(config: Config): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: `http://localhost:${config.port}`,
    ANTHROPIC_AUTH_TOKEN: "lmstudio",
    ANTHROPIC_MODEL: config.mainModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: config.mainModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: config.mainModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: config.backgroundModel,
    ANTHROPIC_SMALL_FAST_MODEL: config.backgroundModel,
    CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
