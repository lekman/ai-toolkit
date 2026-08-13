#!/usr/bin/env node
/**
 * claude-foundry — run one Claude Code session against Claude on Microsoft
 * Foundry.
 *
 * Claude Code speaks to Foundry natively; what it does not ship is a setup
 * wizard. Bedrock has `/setup-bedrock` and Google Cloud has its own; Foundry
 * has neither, so environment variables are the only path and nothing checks
 * them before the first request. A wrong deployment name or an unset model
 * pin surfaces as a failed prompt, not as a configuration error.
 *
 * So this does two things. It hands a Foundry environment to a single child
 * process — bare `claude` keeps whatever your global settings say, and the two
 * run side by side. And it checks the configuration first, because there is no
 * wizard upstream to have checked it already.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import pc from "picocolors";

import {
  authMode,
  azLogin,
  hasNonInteractiveCredential,
  sessionValid,
  UserError,
  which,
} from "./lib/azure.js";
import {
  type EnvFile,
  findEnvFile,
  foundryVarsInSettings,
  HOME_ENV_FILE,
  migrateFromSettings,
  MODEL_VARS,
  REPORTED,
} from "./lib/config.js";
import { type Hosting, INDUSTRIES, runSetup } from "./lib/setup.js";

// package.json sits one level above both src/ (dev) and dist/ (published), so
// the version can never drift from what npm shows.
const VERSION = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

const HELP = `
${pc.bold("claude-foundry")} — run one Claude Code session on Microsoft Foundry

  claude-foundry                   launch on Foundry
  claude-foundry --setup           deploy the models and write the env file
  claude-foundry --status          show what would be used, change nothing
  claude-foundry --resource <name> override the Azure resource
  claude-foundry --no-login        fail rather than opening a browser to log in
  claude-foundry --no-repair       leave global settings alone

${pc.dim("Only with --setup:")}
  --dry-run          show the plan, create nothing
  --yes              skip the confirmation prompt
  --upgrade          deploy the newest model even if an older one is deployed
  --capacity <n>     SKU capacity, in thousands of tokens per minute
  --hosting <where>  ${pc.dim("azure | anthropic — where inference runs")}
  --org <name>       ${pc.dim("organization Anthropic requires before deploying")}
  --industry <kind>  ${pc.dim("technology, finance, healthcare, …")}
  --country <XX>     ${pc.dim("two-letter ISO country code")}

  --help, -h       this text
  --version

${pc.dim("Anything else is passed to claude untouched:")}
  claude-foundry -p "review the diff"
  claude-foundry -- --help         ${pc.dim("claude's help, not this")}

${pc.dim("Foundry has no setup wizard, so --setup is one: it asks the Azure CLI which")}
${pc.dim("resource and deployments exist, creates the missing models, and writes")}
${pc.dim(`${HOME_ENV_FILE}. It creates deployments, never the resource itself.`)}
`;

/** Values that mean someone copied the docs without filling in the blank. */
const PLACEHOLDERS = new Set([
  "resource",
  "resource-name",
  "your-azure-resource",
  "your-resource",
  "your-resource-name",
]);

interface Args {
  setup: boolean;
  status: boolean;
  login: boolean;
  repair: boolean;
  dryRun: boolean;
  yes: boolean;
  upgrade: boolean;
  capacity?: number;
  hosting?: Hosting;
  organization?: string;
  industry?: string;
  country?: string;
  resource?: string;
  passthrough: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    setup: false,
    status: false,
    login: true,
    repair: true,
    dryRun: false,
    yes: false,
    upgrade: false,
    passthrough: [],
  };
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      i++;
      break;
    }
    if (arg === "--setup") args.setup = true;
    else if (arg === "--status") args.status = true;
    else if (arg === "--no-login") args.login = false;
    else if (arg === "--no-repair") args.repair = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--upgrade") args.upgrade = true;
    else if (arg === "--capacity") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new UserError("--capacity takes a positive whole number.");
      }
      args.capacity = value;
    } else if (arg === "--hosting") {
      const value = argv[++i];
      if (value !== "azure" && value !== "anthropic") {
        throw new UserError("--hosting takes `azure` or `anthropic`.");
      }
      args.hosting = value;
    } else if (arg === "--org") args.organization = argv[++i];
    else if (arg === "--industry") {
      const value = (argv[++i] ?? "").toLowerCase();
      if (!(INDUSTRIES as readonly string[]).includes(value)) {
        throw new UserError(
          `--industry takes one of: ${INDUSTRIES.join(", ")}.`,
        );
      }
      args.industry = value;
    } else if (arg === "--country") {
      const value = (argv[++i] ?? "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(value)) {
        throw new UserError("--country takes a two-letter ISO country code.");
      }
      args.country = value;
    } else if (arg === "--resource") args.resource = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--version") {
      console.log(VERSION);
      process.exit(0);
    } else break;
  }
  args.passthrough = argv.slice(i);
  return args;
}

const NO_CONFIG = new UserError(
  `No Foundry configuration found.\n\n` +
    `  Run ${pc.cyan("claude-foundry --setup")} — it asks the Azure CLI which resource\n` +
    `  and deployments you have, creates the models that are missing, and writes\n` +
    `  ${pc.cyan(HOME_ENV_FILE)}. Add ${pc.cyan("--dry-run")} to see the plan first.\n\n` +
    `  Or write the file by hand:\n\n` +
    `    export ANTHROPIC_FOUNDRY_RESOURCE=<your-resource>\n` +
    `    export ANTHROPIC_DEFAULT_OPUS_MODEL='<opus-deployment-name>'\n` +
    `    export ANTHROPIC_DEFAULT_SONNET_MODEL='<sonnet-deployment-name>'\n\n` +
    `  Authenticate with ${pc.cyan("az login")}, or add ANTHROPIC_FOUNDRY_API_KEY.\n` +
    `  Use .claude/foundry.env instead in a repo that must pin one resource.`,
);

/**
 * Build the environment for the child.
 *
 * Repair comes first. Settings `env` applies to every session and outranks
 * anything a parent process exports, so Foundry variables sitting there put
 * bare `claude` on Foundry too, with no way back. Moving them into the env
 * file is what makes the two coexist.
 */
function resolveEnv(args: Args): {
  file?: EnvFile;
  env: Record<string, string>;
  repaired?: string[];
} {
  let repaired: string[] | undefined;
  if (args.repair) {
    const migration = migrateFromSettings();
    if (migration) repaired = migration.moved;
  }

  const file = findEnvFile();
  const env: Record<string, string> = { ...file?.vars };

  if (!file) {
    // --no-repair leaves the variables in settings.json, where Claude Code
    // reads them itself. Nothing to hand over, and nothing is wrong.
    const inSettings = foundryVarsInSettings();
    if (Object.keys(inSettings).length > 0) return { file, env: inSettings };
    throw NO_CONFIG;
  }

  env.CLAUDE_CODE_USE_FOUNDRY ??= "1";
  if (args.resource) {
    env.ANTHROPIC_FOUNDRY_RESOURCE = args.resource;
    // An override that leaves a base URL behind would be silently ignored.
    delete env.ANTHROPIC_FOUNDRY_BASE_URL;
  }
  return { file, env, repaired };
}

/** Read a variable as the child will see it: env file first, then the shell. */
function effective(
  env: Record<string, string>,
  key: string,
): string | undefined {
  return env[key] ?? process.env[key];
}

/**
 * Reject configurations that would fail at the first prompt.
 *
 * Foundry performs no startup model check and builds its endpoint straight
 * from the resource name, so every mistake here reads as a connection error
 * minutes later. Cheap to catch, expensive to debug.
 */
function assertUsable(env: Record<string, string>): void {
  const resource = effective(env, "ANTHROPIC_FOUNDRY_RESOURCE");
  const baseUrl = effective(env, "ANTHROPIC_FOUNDRY_BASE_URL");

  if (resource && baseUrl) {
    throw new UserError(
      `ANTHROPIC_FOUNDRY_RESOURCE and ANTHROPIC_FOUNDRY_BASE_URL are both set.\n` +
        `They are alternatives — the resource name builds the same URL. Keep one.`,
    );
  }
  if (!resource && !baseUrl) throw NO_CONFIG;

  if (resource) {
    const bare = resource.replace(/^[<{]|[>}]$/g, "").toLowerCase();
    if (PLACEHOLDERS.has(bare) || bare !== resource.toLowerCase()) {
      throw new UserError(
        `ANTHROPIC_FOUNDRY_RESOURCE is still a placeholder (${resource}).\n` +
          `Set it to the resource name from the Foundry portal.`,
      );
    }
    if (/[:/]/.test(resource)) {
      throw new UserError(
        `ANTHROPIC_FOUNDRY_RESOURCE looks like a URL (${resource}).\n` +
          `It takes the bare resource name. For a full endpoint, use\n` +
          `ANTHROPIC_FOUNDRY_BASE_URL instead.`,
      );
    }
  }
}

/** Model aliases with no pin, which resolve to a built-in default. */
function unpinned(env: Record<string, string>): string[] {
  return MODEL_VARS.filter((key) => !effective(env, key));
}

/** The line explaining what the pre-flight did or did not tell us. */
function sessionLine(env: Record<string, string>): string {
  const mode = authMode({ ...process.env, ...env } as Record<string, string>);
  if (mode === "token") return `  auth     Entra ID bearer token`;
  if (mode === "key") return `  auth     API key`;
  if (hasNonInteractiveCredential()) {
    return `  auth     Azure credential chain ${pc.dim("(service principal or managed identity)")}`;
  }
  if (!which("az")) {
    return (
      `  auth     Azure credential chain\n` +
      `  ${pc.yellow("az CLI not found")} — session state unknown.`
    );
  }
  const ok = sessionValid();
  return (
    `  auth     Azure credential chain ${pc.dim("(az)")}\n` +
    `  session  ${ok ? pc.green("valid") : pc.yellow("expired or missing")}`
  );
}

function report(file: EnvFile | undefined, env: Record<string, string>): void {
  console.log(pc.bold("\nclaude-foundry\n"));
  console.log(`  source   ${file ? file.path : "~/.claude/settings.json"}`);
  const shown = REPORTED.filter((key) => effective(env, key));
  for (const key of shown) {
    console.log(`  ${key.padEnd(30)} ${effective(env, key)}`);
  }
  if (!shown.length) console.log(pc.dim("  (no Foundry variables set)"));

  console.log(`\n${sessionLine(env)}`);

  const missing = unpinned(env);
  if (missing.length) {
    console.log(
      `\n  ${pc.yellow("unpinned")} ${missing.join(", ")}\n` +
        pc.dim(
          `  These aliases fall back to Claude Code's built-in default for\n` +
            `  Foundry, which lags the newest release. Foundry has no startup\n` +
            `  model check, so an unavailable default fails at the first prompt.`,
        ),
    );
  }
  console.log();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Setup runs before anything reads the env file, because the state it fixes
  // is precisely the one where there is no env file to read.
  if (args.setup) {
    await runSetup({
      resource: args.resource,
      dryRun: args.dryRun,
      yes: args.yes,
      login: args.login,
      capacity: args.capacity,
      hosting: args.hosting,
      upgrade: args.upgrade,
      organization: args.organization,
      industry: args.industry,
      country: args.country,
    });
    return;
  }

  const { file, env, repaired } = resolveEnv(args);
  assertUsable(env);

  if (repaired?.length) {
    console.error(
      pc.dim(
        `[claude-foundry] moved ${repaired.join(", ")} out of settings.json ` +
          `into ${HOME_ENV_FILE} so bare \`claude\` is unaffected.`,
      ),
    );
  }

  if (args.status) {
    report(file, env);
    return;
  }

  if (!which("claude")) {
    throw new UserError(
      "Claude Code is not installed, or `claude` is not on your PATH.\n" +
        "Install it from https://claude.com/claude-code and try again.",
    );
  }

  const missing = unpinned(env);
  if (missing.length) {
    console.error(
      pc.dim(
        `[claude-foundry] no deployment pinned for ${missing.join(", ")} — ` +
          `falling back to Claude Code's default, which Foundry does not verify.`,
      ),
    );
  }

  // An expired Azure CLI session otherwise fails mid-request, which reads as a
  // Foundry outage rather than an auth problem. Only the credential chain is
  // worth checking, and only when `az` is the link that would answer.
  const usesAzCli =
    authMode({ ...process.env, ...env } as Record<string, string>) ===
      "chain" &&
    !hasNonInteractiveCredential() &&
    Boolean(which("az"));
  if (usesAzCli && !sessionValid()) {
    if (!args.login) {
      throw new UserError(
        `Azure session is expired or missing.\nRun: az login`,
      );
    }
    console.error(
      pc.dim(
        `[claude-foundry] Azure session expired — opening browser to log in.`,
      ),
    );
    if (!(await azLogin())) {
      throw new UserError(
        "Azure login failed. Log in manually, then try again.",
      );
    }
  }

  const child = spawn("claude", args.passthrough, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  const code = await new Promise<number>((resolve) => {
    child.on("close", (c) => resolve(c ?? 0));
    child.on("error", () => resolve(1));
  });
  process.exit(code);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${pc.red("error:")} ${message}`);
  process.exit(1);
});
