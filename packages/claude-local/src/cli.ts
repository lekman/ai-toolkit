#!/usr/bin/env node
/**
 * claude-local — run Claude Code against a model on your own machine.
 *
 * One command. Bare `claude-local` launches, installing the backend first if
 * this is the first run. A short reserved set of flags is handled here; the
 * first token that is not one of them ends our parsing and everything from
 * there is passed to `claude` untouched.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { runLaunch } from "./commands/launch.js";
import { runSetup } from "./commands/setup.js";
import { runList, runSwitch } from "./commands/switch.js";
import { type Config, readConfig } from "./lib/config.js";
import { findLms, unloadAll } from "./lib/lms.js";
import { UserError, assertAppleSilicon, run } from "./lib/system.js";

const VERSION = "0.2.0";

const HELP = `
${pc.bold("claude-local")} — run Claude Code against a local model

  claude-local                    launch (installs the backend on first run)
  claude-local --switch           pick a different model
  claude-local --model <key>      switch to that model, then launch
  claude-local --setup            re-run the installer
  claude-local --status           what is downloaded, loaded, and serving
  claude-local --stop             unload the model and stop the server

  --port <n>       server port (default 1234)
  --context <n>    context window when loading a model
  --yes, -y        accept defaults during setup
  --no-launch      do the work, do not start Claude Code
  --help, -h       this text
  --version

${pc.dim("Anything else is passed to claude untouched:")}
  claude-local -p "fix the failing test"
  claude-local --model qwen/qwen3-coder-30b --resume
  claude-local -- --help          ${pc.dim("claude's help, not this")}
`;

interface Args {
  setup: boolean;
  switch: boolean;
  status: boolean;
  stop: boolean;
  launch: boolean;
  yes: boolean;
  model?: string;
  port?: number;
  context?: number;
  /** Everything destined for `claude`. */
  passthrough: string[];
}

/**
 * Reserved flags first, then passthrough. Parsing stops at `--` or at the first
 * token we do not recognise, so Claude Code's own flags survive intact.
 */
function parseArgs(argv: string[]): Args {
  const args: Args = {
    setup: false,
    switch: false,
    status: false,
    stop: false,
    launch: true,
    yes: false,
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
    else if (arg === "--switch") args.switch = true;
    else if (arg === "--status" || arg === "--list") args.status = true;
    else if (arg === "--stop") args.stop = true;
    else if (arg === "--no-launch") args.launch = false;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--port") args.port = Number(argv[++i]);
    else if (arg === "--context") args.context = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--version") {
      console.log(VERSION);
      process.exit(0);
    } else break;
  }
  args.passthrough = argv.slice(i);

  if (args.port !== undefined && !Number.isFinite(args.port)) {
    throw new UserError("--port needs a number.");
  }
  if (args.context !== undefined && !Number.isFinite(args.context)) {
    throw new UserError("--context needs a number.");
  }
  return args;
}

/** Setup is needed when there is no config, or LM Studio is not installed. */
function needsSetup(config: Config | undefined): boolean {
  return config === undefined || findLms() === undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertAppleSilicon();

  const quiet =
    args.passthrough.length > 0 && !args.setup && !args.switch && !args.status;
  if (!quiet) p.intro(pc.bgCyan(pc.black(" claude-local ")));

  let config = readConfig();

  // Reporting and teardown must never trigger an install. Asking what the state
  // is should answer the question, not change it.
  if (args.status) {
    if (needsSetup(config)) {
      p.outro(
        `Not set up yet. Run ${pc.cyan("claude-local")} to install the backend.`,
      );
      return;
    }
    await runList(config!);
    p.outro("Done.");
    return;
  }

  if (args.stop) {
    const lms = findLms();
    if (!lms) {
      p.outro("Nothing to stop — LM Studio is not installed.");
      return;
    }
    unloadAll(lms);
    run(lms, ["server", "stop"]);
    p.outro("Server stopped, memory freed.");
    return;
  }

  if (args.setup || needsSetup(config)) {
    if (!args.setup) {
      p.log.info(
        "First run — setting up the local backend. This happens once.",
      );
    }
    config = await runSetup({
      port: args.port ?? config?.port,
      yes: args.yes,
      server: true,
    });
  }
  // runSetup either returns a config or throws, so this is settled by here.
  if (!config) throw new UserError("Setup did not produce a configuration.");

  if (args.switch || args.model) {
    config = await runSwitch(config, {
      model: args.model,
      context: args.context,
      port: args.port,
    });
  }

  if (!args.launch) {
    p.outro(`Ready. ${pc.cyan("claude-local")} to start.`);
    return;
  }

  if (!quiet) p.outro(`Starting Claude Code on ${pc.cyan(config.mainModel)}`);
  await runLaunch(config, args.passthrough);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  p.log.error(message);
  process.exit(1);
});
