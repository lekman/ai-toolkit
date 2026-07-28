/**
 * The Claude Code side of the wiring: an env file and a `claude-local` wrapper.
 *
 * The two are kept apart from your shell profile on purpose. Nothing is
 * exported globally, so a stray ANTHROPIC_BASE_URL can never silently send a
 * normal `claude` session to the weaker local model. You opt in per command.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const ENV_FILE = join(homedir(), ".claude", "local-model.env");
export const WRAPPER = join(homedir(), ".local", "bin", "claude-local");
export const DEFAULT_PORT = 1234;

export interface Wiring {
  port: number;
  mainModel: string;
  backgroundModel: string;
}

export function writeEnvFile({
  port,
  mainModel,
  backgroundModel,
}: Wiring): void {
  mkdirSync(dirname(ENV_FILE), { recursive: true });
  writeFileSync(
    ENV_FILE,
    [
      "# Point Claude Code at the local LM Studio server.",
      "# Written by @lekman/claude-local. Sourced only by the claude-local wrapper.",
      `export ANTHROPIC_BASE_URL="http://localhost:${port}"`,
      'export ANTHROPIC_AUTH_TOKEN="lmstudio"',
      `export ANTHROPIC_MODEL="${mainModel}"`,
      `export ANTHROPIC_DEFAULT_OPUS_MODEL="${mainModel}"`,
      `export ANTHROPIC_DEFAULT_SONNET_MODEL="${mainModel}"`,
      `export ANTHROPIC_DEFAULT_HAIKU_MODEL="${backgroundModel}"`,
      `export ANTHROPIC_SMALL_FAST_MODEL="${backgroundModel}"`,
      "export CLAUDE_CODE_ATTRIBUTION_HEADER=0",
      "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
      "",
    ].join("\n"),
    "utf8",
  );
}

export function writeWrapper(port: number): void {
  mkdirSync(dirname(WRAPPER), { recursive: true });
  writeFileSync(
    WRAPPER,
    [
      "#!/usr/bin/env bash",
      "# Run Claude Code against the local model. Written by @lekman/claude-local.",
      "set -euo pipefail",
      "# shellcheck disable=SC1091",
      `source "${ENV_FILE}"`,
      `if ! curl -sf -m 3 "http://localhost:${port}/v1/models" >/dev/null; then`,
      `  echo "Local server is not responding on port ${port}. Run: switch-claude-local" >&2`,
      "  exit 1",
      "fi",
      'exec claude "$@"',
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(WRAPPER, 0o755);
}

/** Rewrite one exported variable in place, leaving the rest of the file alone. */
export function setEnvVar(name: string, value: string): void {
  if (!existsSync(ENV_FILE)) return;
  const line = `export ${name}="${value}"`;
  const pattern = new RegExp(`^export ${name}=.*$`, "m");
  const current = readFileSync(ENV_FILE, "utf8");
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current}${line}\n`;
  writeFileSync(ENV_FILE, next, "utf8");
}

export function readEnvVar(name: string): string | undefined {
  if (!existsSync(ENV_FILE)) return undefined;
  const match = readFileSync(ENV_FILE, "utf8").match(
    new RegExp(`^export ${name}="?([^"\\n]*)"?$`, "m"),
  );
  return match?.[1];
}

export function configuredPort(): number {
  const url = readEnvVar("ANTHROPIC_BASE_URL");
  const port = url ? Number(new URL(url).port) : Number.NaN;
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
}
