/**
 * Swap which local model is loaded.
 *
 * Only one model fits in unified memory at a time, so this swaps rather than
 * adds: start the server, unload what is resident, load the new one at a
 * context size the machine can hold, and record it as current.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";

import { contextFor, matchModel, type Model, MODELS } from "../lib/catalog.js";
import { type Config, writeConfig } from "../lib/config.js";
import {
  download,
  listDownloaded,
  listLoaded,
  load,
  requireLms,
  serverRunning,
  startServer,
  unloadAll,
} from "../lib/lms.js";
import { cancelled } from "../lib/prompt.js";
import { readMachine, UserError } from "../lib/system.js";

export type Candidate = Model & { onDisk: boolean };

/** Catalog entries plus anything else already sitting on disk. */
export function candidates(downloaded: string[]): Candidate[] {
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

/** The catalog key of the model currently loaded, if any. */
export function loadedKey(lms: string): string | undefined {
  return listLoaded(lms).map((l) => matchModel(l)?.key ?? l)[0];
}

export interface SwitchOptions {
  model?: string;
  context?: number;
  port?: number;
}

/** Switch the active model, loading it and persisting the choice. */
export async function runSwitch(
  config: Config,
  opts: SwitchOptions,
): Promise<Config> {
  const lms = requireLms();
  const machine = readMachine();
  const port = opts.port ?? config.port;
  const current = loadedKey(lms);
  const models = candidates(listDownloaded(lms));

  let target: Candidate;
  if (opts.model) {
    const found = models.find((m) => m.key === opts.model);
    if (!found) {
      throw new UserError(
        `Unknown model: ${opts.model}. Run \`claude-local --status\` to see the options.`,
      );
    }
    target = found;
  } else {
    p.log.info(
      current
        ? `Currently loaded: ${pc.cyan(current)}`
        : "Nothing is loaded right now.",
    );
    const choice = await p.select({
      message: "Load which model?",
      initialValue: current,
      options: models
        .filter((m) => m.onDisk || m.minRamGb <= machine.ramGb)
        .map((m) => ({
          value: m.key,
          label: m.label,
          hint:
            m.key === current
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
    if (!(await download(lms, target.key))) {
      throw new UserError(`Download failed. Run: lms get ${target.key} --mlx`);
    }
  }

  const context = opts.context ?? contextFor(target, machine.ramGb);
  if (target.key === current && (await serverRunning(port))) {
    p.log.info("Already loaded and serving.");
  } else {
    await startServer(lms, port);
    // Unload first. Loading on top of a resident model pushes the machine into
    // swap, which is slower than any context window you gained.
    p.log.step("Freeing memory");
    unloadAll(lms);
    p.log.step(`Loading ${target.label} at ${context.toLocaleString()} tokens`);
    await load(lms, target.key, context);
  }

  if (target.role === "background") {
    p.log.warn(
      "This is a background model. Expect it to struggle with real work.",
    );
  }

  const next: Config = { ...config, port, mainModel: target.key, context };
  writeConfig(next);
  p.log.success(`claude-local now runs ${target.key}`);
  return next;
}

/** Print what is downloaded, what is loaded, and whether the server is up. */
export async function runList(config: Config): Promise<void> {
  const lms = requireLms();
  const current = loadedKey(lms);
  const models = candidates(listDownloaded(lms));
  const width = Math.max(...models.map((m) => m.key.length));

  p.note(
    models
      .map((m) => {
        const state =
          m.key === current
            ? pc.green("loaded")
            : m.onDisk
              ? "on disk"
              : pc.dim("not downloaded");
        return `${m.key.padEnd(width)}  ${state}`;
      })
      .join("\n"),
    "Models",
  );

  const up = await serverRunning(config.port);
  p.log.message(
    up
      ? `Server up on port ${config.port}, context ${config.context.toLocaleString()}.`
      : pc.yellow(`Server not running on port ${config.port}.`),
  );
  if (current && current !== config.mainModel) {
    p.log.warn(
      `Config says ${config.mainModel} but ${current} is loaded. ` +
        "Launching will reload the configured one.",
    );
  }
}
