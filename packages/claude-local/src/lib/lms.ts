/**
 * Wrapper around LM Studio's `lms` CLI.
 *
 * LM Studio is the backend because it serves Anthropic's own /v1/messages API,
 * so Claude Code's tool calls round-trip with no translating proxy in between.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  UserError,
  appInstalled,
  run,
  runInherit,
  sleep,
  which,
} from "./system.js";

const BUNDLED_LMS = join(homedir(), ".lmstudio", "bin", "lms");

export function findLms(): string | undefined {
  return which("lms") ?? (existsSync(BUNDLED_LMS) ? BUNDLED_LMS : undefined);
}

export async function installLmStudio(): Promise<void> {
  // An existing CLI counts as installed even if the app was put somewhere other
  // than /Applications, so re-running setup never triggers a pointless reinstall.
  if (appInstalled("LM Studio") || findLms()) return;
  const code = await runInherit("brew", ["install", "--cask", "lm-studio"]);
  if (code !== 0) throw new UserError("Homebrew could not install LM Studio.");
}

/**
 * The `lms` CLI lives inside LM Studio's support directory and is only put on
 * PATH once the app has run at least once and `lms bootstrap` has been called.
 */
export async function ensureLms(): Promise<string> {
  let lms = findLms();
  if (!lms) {
    await runInherit("open", ["-a", "LM Studio"]);
    for (let i = 0; i < 60 && !lms; i++) {
      await sleep(2000);
      lms = findLms();
    }
  }
  if (!lms) {
    throw new UserError(
      "LM Studio did not install its CLI. Open the app, finish onboarding, then run setup again.",
    );
  }
  if (lms === BUNDLED_LMS) run(lms, ["bootstrap"]);
  return lms;
}

export function requireLms(): string {
  const lms = findLms();
  if (!lms) {
    throw new UserError(
      "LM Studio is not set up yet. Run `setup-claude-local` first.",
    );
  }
  return lms;
}

/** Model keys present on disk. */
export function listDownloaded(lms: string): string[] {
  const json = run(lms, ["ls", "--json"]);
  if (json.code === 0) {
    try {
      const parsed = JSON.parse(json.stdout) as Array<{
        modelKey?: string;
        path?: string;
      }>;
      const keys = parsed
        .map((m) => m.modelKey ?? m.path)
        .filter((k): k is string => !!k);
      if (keys.length) return keys;
    } catch {
      // Older CLI versions ignore --json and print the table anyway.
    }
  }
  const text = run(lms, ["ls"]);
  return text.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s{2,}|\s/)[0] ?? "")
    .filter((token) => token.includes("/"));
}

/** Model keys currently held in memory. */
export function listLoaded(lms: string): string[] {
  const json = run(lms, ["ps", "--json"]);
  if (json.code === 0) {
    try {
      const parsed = JSON.parse(json.stdout) as Array<{
        modelKey?: string;
        identifier?: string;
      }>;
      const keys = parsed
        .map((m) => m.modelKey ?? m.identifier)
        .filter((k): k is string => !!k);
      if (keys.length) return keys;
    } catch {
      // Fall through to the text form.
    }
  }
  return run(lms, ["ps"])
    .stdout.split("\n")
    .map((line) => line.trim().split(/\s{2,}|\s/)[0] ?? "")
    .filter((token) => token.includes("/"));
}

export async function serverRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/v1/models`, {
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startServer(lms: string, port: number): Promise<void> {
  if (await serverRunning(port)) return;
  const code = await runInherit(lms, [
    "server",
    "start",
    "--port",
    String(port),
  ]);
  if (code !== 0)
    throw new UserError(
      `Could not start the LM Studio server on port ${port}.`,
    );
}

export async function download(lms: string, key: string): Promise<boolean> {
  // --mlx picks the Apple Silicon build, which beats GGUF on M-series.
  const code = await runInherit(lms, ["get", key, "--mlx", "--yes"]);
  return code === 0;
}

export function unloadAll(lms: string): void {
  run(lms, ["unload", "--all"]);
}

export async function load(
  lms: string,
  key: string,
  context: number,
): Promise<void> {
  const code = await runInherit(lms, [
    "load",
    key,
    "--context-length",
    String(context),
    "--gpu",
    "max",
    "--yes",
  ]);
  if (code !== 0)
    throw new UserError(
      `Could not load ${key}. Try loading it from the LM Studio UI.`,
    );
}
