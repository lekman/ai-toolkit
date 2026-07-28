#!/usr/bin/env node
/**
 * setup-claude-local — install and wire up a local model backend for Claude Code.
 *
 * Pick what to install from a checkbox list. The core pack is always included;
 * models are optional and sized against the machine's memory. Re-running is
 * safe: anything already present is skipped.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { MODELS, type Model, contextFor, findModel } from "./lib/catalog.js";
import {
  DEFAULT_PORT,
  ENV_FILE,
  WRAPPER,
  writeEnvFile,
  writeWrapper,
} from "./lib/config.js";
import {
  download,
  ensureLms,
  installLmStudio,
  listDownloaded,
  load,
  startServer,
} from "./lib/lms.js";
import { UserError, assertAppleSilicon, readMachine } from "./lib/system.js";

const CORE = "core";

interface Options {
  port: number;
  yes: boolean;
  server: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { port: DEFAULT_PORT, yes: false, server: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") opts.port = Number(argv[++i]);
    else if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--no-server") opts.server = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else throw new UserError(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(opts.port) || opts.port <= 0)
    throw new UserError("--port needs a number.");
  return opts;
}

const HELP = `
setup-claude-local — install a local model backend for Claude Code

  --yes, -y      accept the recommended selection without prompting
  --port <n>     serve on this port (default ${DEFAULT_PORT})
  --no-server    install only; do not start the server or load a model
  --help, -h     this text
`;

function cancelled(value: unknown): never | void {
  if (p.isCancel(value)) {
    p.cancel("Nothing was changed.");
    process.exit(0);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  p.intro(pc.bgCyan(pc.black(" setup-claude-local ")));

  assertAppleSilicon();
  const machine = readMachine();
  if (!machine.hasHomebrew) {
    throw new UserError(
      "Homebrew not found. Install it from https://brew.sh, then run this again.",
    );
  }

  p.log.info(
    `${machine.ramGb} GB unified memory, ${machine.freeDiskGb} GB free on disk.`,
  );

  // Unified memory holds the weights and the context. macOS wires roughly 75%
  // of RAM to the GPU, so anything needing more than that is not offered.
  const fits = MODELS.filter((m) => m.minRamGb <= machine.ramGb);
  const tooBig = MODELS.filter((m) => m.minRamGb > machine.ramGb);
  if (tooBig.length) {
    p.log.warn(
      `Not offered on ${machine.ramGb} GB: ${tooBig.map((m) => m.label).join(", ")}. ` +
        "The weights would leave no room for a usable context window.",
    );
  }
  if (!fits.some((m) => m.role === "main")) {
    throw new UserError(`No model in the catalog fits in ${machine.ramGb} GB.`);
  }

  const recommended = [
    CORE,
    ...fits.filter((m) => m.recommended).map((m) => m.key),
  ];

  let picked: string[];
  if (opts.yes) {
    picked = recommended;
  } else {
    const answer = await p.multiselect({
      message: "What should be installed?",
      required: false,
      initialValues: recommended,
      options: [
        {
          value: CORE,
          label: "Core pack",
          hint: "LM Studio, the lms CLI, and the claude-local wrapper — always installed",
        },
        ...fits.map((m) => ({
          value: m.key,
          label: `${m.label}  ${pc.dim(`${m.sizeGb} GB`)}`,
          hint: m.note,
        })),
      ],
    });
    cancelled(answer);
    picked = answer as string[];
  }

  // The core pack is not optional; unchecking it is treated as a slip.
  if (!picked.includes(CORE)) picked = [CORE, ...picked];

  let models = picked
    .filter((v) => v !== CORE)
    .map(findModel)
    .filter((m): m is Model => m !== undefined);

  // Claude Code needs something to answer with. If only the small background
  // model was picked, add the recommended main model back.
  if (!models.some((m) => m.role === "main")) {
    const fallback =
      fits.find((m) => m.role === "main" && m.recommended) ?? fits[0];
    if (fallback) {
      p.log.warn(
        `No main model selected. Adding ${fallback.label} — nothing would answer without it.`,
      );
      models = [fallback, ...models];
    }
  }

  const mainModel = models.find((m) => m.role === "main") ?? models[0];
  if (!mainModel) throw new UserError("No models selected.");
  const backgroundModel =
    models.find((m) => m.role === "background") ?? mainModel;

  const lmsPath = await ensureLmsWithSpinner();
  const onDisk = new Set(listDownloaded(lmsPath));
  const toDownload = models.filter((m) => !isDownloaded(onDisk, m));
  const totalGb = toDownload.reduce((sum, m) => sum + m.sizeGb, 0);

  if (toDownload.length) {
    if (totalGb > machine.freeDiskGb) {
      throw new UserError(
        `Need about ${totalGb} GB but only ${machine.freeDiskGb} GB is free.`,
      );
    }
    if (!opts.yes) {
      const go = await p.confirm({
        message: `Download ${toDownload.length} model(s), about ${totalGb} GB?`,
      });
      cancelled(go);
      if (!go) {
        p.cancel("Stopped before downloading. The core pack is installed.");
        process.exit(0);
      }
    }
    for (const model of toDownload) {
      p.log.step(`Downloading ${model.label} (${model.sizeGb} GB)`);
      const ok = await download(lmsPath, model.key);
      if (!ok)
        p.log.warn(
          `Could not download ${model.key}. Run: lms get ${model.key} --mlx`,
        );
    }
  } else {
    p.log.info("All selected models are already downloaded.");
  }

  writeEnvFile({
    port: opts.port,
    mainModel: mainModel.key,
    backgroundModel: backgroundModel.key,
  });
  writeWrapper(opts.port);
  p.log.success(`Wrote ${ENV_FILE}\n        ${WRAPPER}`);

  if (opts.server) {
    const context = contextFor(mainModel, machine.ramGb);
    p.log.step(`Starting the server on port ${opts.port}`);
    await startServer(lmsPath, opts.port);
    // Left to load on demand, LM Studio uses the model's default context, which
    // is usually far too small for Claude Code's prompts.
    p.log.step(
      `Loading ${mainModel.label} at ${context.toLocaleString()} tokens`,
    );
    await load(lmsPath, mainModel.key, context);
  }

  p.note(
    [
      `${pc.cyan("claude-local")}            run Claude Code against ${mainModel.label}`,
      `${pc.cyan("claude")}                  unchanged, still the hosted model`,
      `${pc.cyan("switch-claude-local")}     change which local model is loaded`,
    ].join("\n"),
    "Ready",
  );
  p.outro(
    process.env.PATH?.includes("/.local/bin")
      ? "Done."
      : `Done. Add ${pc.cyan("~/.local/bin")} to your PATH to use claude-local.`,
  );
}

function isDownloaded(onDisk: Set<string>, model: Model): boolean {
  const short = model.key.split("/").pop() ?? model.key;
  for (const entry of onDisk) {
    const lower = entry.toLowerCase();
    if (
      lower.includes(model.key.toLowerCase()) ||
      lower.includes(short.toLowerCase())
    )
      return true;
  }
  return false;
}

async function ensureLmsWithSpinner(): Promise<string> {
  const spin = p.spinner();
  spin.start("Installing LM Studio");
  await installLmStudio();
  spin.message("Locating the lms CLI");
  const lmsPath = await ensureLms();
  spin.stop(`LM Studio ready (${lmsPath})`);
  return lmsPath;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  p.log.error(message);
  p.outro(pc.red("Setup did not finish."));
  process.exit(1);
});
