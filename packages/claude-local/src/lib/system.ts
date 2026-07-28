/** Machine facts and process helpers. Node APIs only, so `npx` works. */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

export interface Machine {
  ramGb: number;
  freeDiskGb: number;
  hasHomebrew: boolean;
}

export class UserError extends Error {}

export function assertAppleSilicon(): void {
  if (os.platform() !== "darwin") {
    throw new UserError(
      "macOS only. This relies on MLX and Apple unified memory.",
    );
  }
  if (os.arch() !== "arm64") {
    throw new UserError("Apple Silicon only (M-series).");
  }
}

export function readMachine(): Machine {
  const free = spawnSync("df", ["-g", "/"], { encoding: "utf8" });
  const freeDiskGb = Number(
    free.stdout?.split("\n")[1]?.trim().split(/\s+/)[3] ?? 0,
  );
  return {
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    freeDiskGb: Number.isFinite(freeDiskGb) ? freeDiskGb : 0,
    hasHomebrew: which("brew") !== undefined,
  };
}

export function which(cmd: string): string | undefined {
  const r = spawnSync("command", ["-v", cmd], {
    encoding: "utf8",
    shell: "/bin/bash",
  });
  const path = r.stdout?.trim();
  return r.status === 0 && path ? path : undefined;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command and capture its output. Never throws on a non-zero exit. */
export function run(cmd: string, args: string[]): RunResult {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/**
 * Run a command with its output going straight to the terminal. Used for the
 * long steps — Homebrew installs and multi-gigabyte downloads — where hiding
 * progress behind a spinner would leave the user staring at nothing.
 */
export function runInherit(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

export function appInstalled(name: string): boolean {
  return existsSync(`/Applications/${name}.app`);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
