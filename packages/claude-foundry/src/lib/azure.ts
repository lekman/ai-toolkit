/** Azure credential checks. Node APIs only, so the published CLI runs under `npx`. */

import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/** The audience Microsoft Foundry inference tokens are issued for. */
const FOUNDRY_SCOPE = "https://cognitiveservices.azure.com";

/** An error whose message is shown to the user as-is, without a stack trace. */
export class UserError extends Error {}

/**
 * How Claude Code will authenticate to Foundry, in the order it decides.
 *
 * `token` outranks `key`, and `key` outranks the Azure SDK default credential
 * chain. Only the chain is worth a pre-flight — the other two are static
 * strings that either work or return 401 on the first request.
 */
export type AuthMode = "chain" | "key" | "token";

/**
 * Find an executable on PATH. Walks PATH directly rather than shelling out to
 * `command -v`, which needs `shell: true` and trips Node's DEP0190 warning.
 */
export function which(cmd: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, cmd);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here, or not executable — keep looking.
    }
  }
  return undefined;
}

/** Run a command with output going straight to the terminal; resolves to its exit code. */
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

/** Which credential Claude Code will use, given the environment handed to it. */
export function authMode(env: Record<string, string>): AuthMode {
  if (env.ANTHROPIC_FOUNDRY_AUTH_TOKEN) return "token";
  if (env.ANTHROPIC_FOUNDRY_API_KEY) return "key";
  return "chain";
}

/**
 * Is some non-interactive link in the credential chain configured?
 *
 * The chain is not just the Azure CLI: a service principal, a workload
 * identity, or a managed identity all sit ahead of or beside it. When one of
 * those is present, an unauthenticated `az` says nothing about whether the
 * request will succeed, so the pre-flight is skipped rather than reported as a
 * problem it cannot see.
 */
export function hasNonInteractiveCredential(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const servicePrincipal =
    Boolean(env.AZURE_TENANT_ID) &&
    Boolean(env.AZURE_CLIENT_ID) &&
    Boolean(
      env.AZURE_CLIENT_SECRET ||
      env.AZURE_CLIENT_CERTIFICATE_PATH ||
      env.AZURE_FEDERATED_TOKEN_FILE,
    );
  const managedIdentity = Boolean(
    env.IDENTITY_ENDPOINT || env.MSI_ENDPOINT || env.AZURE_FEDERATED_TOKEN_FILE,
  );
  return servicePrincipal || managedIdentity;
}

/**
 * Can the Azure CLI mint a Foundry token right now?
 *
 * Asks for the inference audience rather than just checking that an account is
 * logged in — a stale token for the wrong scope fails at request time, which is
 * exactly the failure this is here to catch.
 */
export function sessionValid(timeoutMs = 15000): boolean {
  const r = spawnSync(
    "az",
    [
      "account",
      "get-access-token",
      "--resource",
      FOUNDRY_SCOPE,
      "--output",
      "tsv",
      "--query",
      "expiresOn",
    ],
    { encoding: "utf8", timeout: timeoutMs },
  );
  return r.status === 0;
}

/**
 * Refresh an expired Azure CLI session. Opens a browser, so it only works
 * where a human can click — a headless run should inherit a credential from
 * the chain, not start one here.
 */
export async function azLogin(): Promise<boolean> {
  return (await runInherit("az", ["login"])) === 0;
}
