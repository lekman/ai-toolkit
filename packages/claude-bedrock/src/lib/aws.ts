/** AWS session checks. Node APIs only, so the published CLI runs under `npx`. */

import { spawn, spawnSync } from "node:child_process";

export class UserError extends Error {}

export function which(cmd: string): string | undefined {
  const r = spawnSync("command", ["-v", cmd], {
    encoding: "utf8",
    shell: "/bin/bash",
  });
  const path = r.stdout?.trim();
  return r.status === 0 && path ? path : undefined;
}

export function runInherit(
  cmd: string,
  args: string[],
  env = process.env,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/**
 * Is there a usable session for this profile? `sts get-caller-identity` is the
 * cheapest call that actually exercises the credentials, rather than trusting
 * that a config entry exists.
 */
export function sessionValid(
  profile: string | undefined,
  timeoutMs = 15000,
): boolean {
  const args = [
    "sts",
    "get-caller-identity",
    "--output",
    "text",
    "--query",
    "Account",
  ];
  if (profile) args.push("--profile", profile);
  const r = spawnSync("aws", args, { encoding: "utf8", timeout: timeoutMs });
  return r.status === 0;
}

/**
 * Refresh an expired SSO session. Opens a browser, so it only works where a
 * human can click — a headless run should inherit a session, not start one.
 */
export async function ssoLogin(profile: string | undefined): Promise<boolean> {
  const args = ["sso", "login"];
  if (profile) args.push("--profile", profile);
  return (await runInherit("aws", args)) === 0;
}
