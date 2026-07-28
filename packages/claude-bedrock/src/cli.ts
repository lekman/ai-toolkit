#!/usr/bin/env node
/**
 * claude-bedrock — run one Claude Code session against AWS Bedrock.
 *
 * A launcher, not a setup tool. Claude Code ships `/setup-bedrock`, which
 * discovers your profiles, resolves the region, checks which models your
 * account can actually invoke, and pins them. This does not duplicate any of
 * that.
 *
 * What it adds is the one thing first-party does not: per-invocation choice.
 * `/setup-bedrock` writes global settings, so turning Bedrock on turns it on
 * for every session. Here the environment reaches one child process and
 * nothing else, so `claude` and `claude-bedrock` can run side by side.
 */

import { spawn } from "node:child_process";
import pc from "picocolors";
import { UserError, sessionValid, ssoLogin, which } from "./lib/aws.js";
import {
  HOME_ENV_FILE,
  REPORTED,
  type EnvFile,
  findEnvFile,
  settingsHasBedrock,
} from "./lib/config.js";

const VERSION = "0.1.0";

const HELP = `
${pc.bold("claude-bedrock")} — run one Claude Code session on AWS Bedrock

  claude-bedrock                  launch on Bedrock
  claude-bedrock --status         show what would be used, change nothing
  claude-bedrock --profile <name> override the AWS profile
  claude-bedrock --no-login       fail rather than opening a browser to log in

  --help, -h       this text
  --version

${pc.dim("Anything else is passed to claude untouched:")}
  claude-bedrock -p "review the diff"
  claude-bedrock -- --help        ${pc.dim("claude's help, not this")}

${pc.dim("Setup is first-party — run `claude` then `/setup-bedrock`, or write")}
${pc.dim(`an env file at ${HOME_ENV_FILE} or .claude/bedrock.env in a repo.`)}
`;

interface Args {
  status: boolean;
  login: boolean;
  profile?: string;
  passthrough: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { status: false, login: true, passthrough: [] };
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      i++;
      break;
    }
    if (arg === "--status") args.status = true;
    else if (arg === "--no-login") args.login = false;
    else if (arg === "--profile") args.profile = argv[++i];
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

/**
 * Build the environment for the child. An env file supplies it; failing that,
 * settings.json from `/setup-bedrock` already carries it and Claude Code will
 * read that itself, so we only need to not get in the way.
 */
function resolveEnv(args: Args): {
  file?: EnvFile;
  env: Record<string, string>;
} {
  const file = findEnvFile();
  const env: Record<string, string> = { ...file?.vars };

  if (!file && !settingsHasBedrock()) {
    throw new UserError(
      `No Bedrock configuration found.\n\n` +
        `  Run ${pc.cyan("claude")} then ${pc.cyan("/setup-bedrock")} — it detects your AWS\n` +
        `  profiles, checks which models your account can invoke, and pins them.\n\n` +
        `  Or write an env file at ${HOME_ENV_FILE}, or .claude/bedrock.env\n` +
        `  in a repo that must pin a specific account.`,
    );
  }

  // Only force the flag on when an env file is driving this. If settings.json
  // is the source, Claude Code reads it directly and setting it here would
  // mask a deliberate change made through /setup-bedrock.
  if (file) env.CLAUDE_CODE_USE_BEDROCK ??= "1";
  if (args.profile) env.AWS_PROFILE = args.profile;
  return { file, env };
}

function report(file: EnvFile | undefined, env: Record<string, string>): void {
  console.log(pc.bold("\nclaude-bedrock\n"));
  console.log(
    `  source   ${file ? file.path : `~/.claude/settings.json (${pc.dim("/setup-bedrock")})`}`,
  );
  const shown = REPORTED.filter((k) => env[k] ?? process.env[k]);
  for (const key of shown) {
    console.log(`  ${key.padEnd(30)} ${env[key] ?? process.env[key]}`);
  }
  if (!shown.length) console.log(pc.dim("  (no Bedrock variables set)"));

  const profile = env.AWS_PROFILE || process.env.AWS_PROFILE;
  if (!which("aws")) {
    console.log(
      `\n  ${pc.yellow("aws CLI not found")} — session state unknown.`,
    );
  } else {
    const ok = sessionValid(profile);
    console.log(
      `\n  session  ${ok ? pc.green("valid") : pc.yellow("expired or missing")}` +
        (profile ? pc.dim(` (profile ${profile})`) : ""),
    );
  }
  console.log();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { file, env } = resolveEnv(args);

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

  // An expired SSO session fails mid-request otherwise, which reads as a
  // Bedrock outage rather than an auth problem.
  const profile = env.AWS_PROFILE || process.env.AWS_PROFILE;
  if (which("aws") && !sessionValid(profile)) {
    if (!args.login) {
      throw new UserError(
        `AWS session is expired or missing${profile ? ` for profile ${profile}` : ""}.\n` +
          `Run: aws sso login${profile ? ` --profile ${profile}` : ""}`,
      );
    }
    console.error(
      pc.dim(
        `[claude-bedrock] AWS session expired — opening browser to log in.`,
      ),
    );
    if (!(await ssoLogin(profile))) {
      throw new UserError("AWS login failed. Log in manually, then try again.");
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
