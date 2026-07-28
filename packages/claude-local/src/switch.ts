#!/usr/bin/env node
/**
 * switch-claude-local — change which local model Claude Code talks to.
 *
 * Reads what is on disk and what is in memory, then runs the unload / load /
 * rewire sequence for the model you pick. Only one model fits in unified
 * memory at a time, so switching means swapping, not adding.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { MODELS, type Model, contextFor, matchModel } from "./lib/catalog.js";
import { configuredPort, readEnvVar, setEnvVar } from "./lib/config.js";
import {
  download,
  listDownloaded,
  listLoaded,
  load,
  requireLms,
  serverRunning,
  startServer,
  unloadAll,
} from "./lib/lms.js";
import {
  UserError,
  assertAppleSilicon,
  readMachine,
  runInherit,
} from "./lib/system.js";

interface Options {
  port?: number;
  model?: string;
  context?: number;
  list: boolean;
  launch: boolean | undefined;
}

const HELP = `
switch-claude-local — swap the loaded local model

  --list             show what is downloaded and loaded, then exit
  --model <key>      switch to this model without prompting
  --context <n>      context window to load with (default: sized to your RAM)
  --port <n>         server port (default: whatever setup wrote)
  --launch           start claude-local when done
  --no-launch        do not offer to start claude-local
  --help, -h         this text
`;

function parseArgs(argv: string[]): Options {
  const opts: Options = { list: false, launch: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list" || arg === "-l") opts.list = true;
    else if (arg === "--model" || arg === "-m") opts.model = argv[++i];
    else if (arg === "--context") opts.context = Number(argv[++i]);
    else if (arg === "--port") opts.port = Number(argv[++i]);
    else if (arg === "--launch") opts.launch = true;
    else if (arg === "--no-launch") opts.launch = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else throw new UserError(`Unknown argument: ${arg}`);
  }
  return opts;
}

function cancelled(value: unknown): void {
  if (p.isCancel(value)) {
    p.cancel("Nothing was changed.");
    process.exit(0);
  }
}

/** Catalog entries plus anything else already sitting on disk. */
function availableModels(
  downloaded: string[],
): Array<Model & { onDisk: boolean }> {
  const known = MODELS.map((m) => ({
    ...m,
    onDisk: downloaded.some((d) => matchModel(d)?.key === m.key),
  }));
  const extras = downloaded
    .filter((d) => !matchModel(d))
    .map((key) => ({
      key,
      label: key,
      sizeGb: 0,
      minRamGb: 0,
      role: "main" as const,
      recommended: false,
      note: "Downloaded outside this tool.",
      onDisk: true,
    }));
  return [...known, ...extras];
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  assertAppleSilicon();
  const lms = requireLms();
  const machine = readMachine();
  const port = opts.port ?? configuredPort();

  const downloaded = listDownloaded(lms);
  const loaded = listLoaded(lms);
  const loadedKey = loaded.map((l) => matchModel(l)?.key ?? l)[0];
  const models = availableModels(downloaded);

  if (opts.list) {
    p.intro(pc.bgCyan(pc.black(" local models ")));
    const width = Math.max(...models.map((m) => m.key.length));
    p.note(
      models
        .map((m) => {
          const state =
            m.key === loadedKey
              ? pc.green("loaded")
              : m.onDisk
                ? "on disk"
                : pc.dim("not downloaded");
          return `${m.key.padEnd(width)}  ${state}`;
        })
        .join("\n"),
      "Models",
    );
    p.outro(
      (await serverRunning(port))
        ? `Server up on port ${port}.`
        : pc.yellow(`Server not running on port ${port}.`),
    );
    return;
  }

  p.intro(pc.bgCyan(pc.black(" switch-claude-local ")));
  p.log.info(
    loadedKey
      ? `Currently loaded: ${pc.cyan(loadedKey)}`
      : "Nothing is loaded right now.",
  );

  let target: Model & { onDisk: boolean };
  if (opts.model) {
    const found = models.find((m) => m.key === opts.model);
    if (!found)
      throw new UserError(
        `Unknown model: ${opts.model}. Run --list to see the options.`,
      );
    target = found;
  } else {
    const choice = await p.select({
      message: "Load which model?",
      initialValue: loadedKey,
      options: models
        .filter((m) => m.onDisk || m.minRamGb <= machine.ramGb)
        .map((m) => ({
          value: m.key,
          label: m.label,
          hint:
            m.key === loadedKey
              ? "loaded now"
              : m.onDisk
                ? m.note
                : `not downloaded — ${m.sizeGb} GB will be fetched`,
        })),
    });
    cancelled(choice);
    target = models.find((m) => m.key === choice)!;
  }

  if (!target.onDisk) {
    p.log.step(`Downloading ${target.label} (${target.sizeGb} GB)`);
    const ok = await download(lms, target.key);
    if (!ok)
      throw new UserError(`Download failed. Run: lms get ${target.key} --mlx`);
  }

  if (target.key === loadedKey && (await serverRunning(port))) {
    p.log.info("Already loaded and serving. Nothing to do.");
  } else {
    const context = opts.context ?? contextFor(target, machine.ramGb);
    await startServer(lms, port);
    // Unload first. Loading on top of a resident model pushes the machine into
    // swap, which is slower than any context window you gained.
    p.log.step("Freeing memory");
    unloadAll(lms);
    p.log.step(`Loading ${target.label} at ${context.toLocaleString()} tokens`);
    await load(lms, target.key, context);
  }

  // Keep the wrapper's default in step with what is actually in memory.
  setEnvVar("ANTHROPIC_MODEL", target.key);
  setEnvVar("ANTHROPIC_DEFAULT_OPUS_MODEL", target.key);
  setEnvVar("ANTHROPIC_DEFAULT_SONNET_MODEL", target.key);
  if (target.role === "background") {
    p.log.warn(
      "This is a background model. Expect it to struggle with real work.",
    );
  }
  p.log.success(`claude-local now runs ${target.key}`);

  const background = readEnvVar("ANTHROPIC_DEFAULT_HAIKU_MODEL");
  if (background && background !== target.key) {
    p.log.info(
      `Background tasks still point at ${background}, which is not loaded. ` +
        "LM Studio will load it on demand and evict this one — expect a pause.",
    );
  }

  let launch = opts.launch;
  if (launch === undefined) {
    const answer = await p.confirm({
      message: "Start claude-local now?",
      initialValue: false,
    });
    cancelled(answer);
    launch = answer as boolean;
  }

  p.outro("Done.");
  if (launch) await runInherit("claude-local", []);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  p.log.error(message);
  p.outro(pc.red("Switch did not finish."));
  process.exit(1);
});
