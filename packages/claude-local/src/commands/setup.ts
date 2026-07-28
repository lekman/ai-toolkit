/**
 * Install and wire up the local model backend.
 *
 * Pick what to install from a checkbox list. The core pack is always included;
 * models are optional and sized against the machine's memory. Re-running is
 * safe: anything already present is skipped.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  MODELS,
  type Model,
  contextFor,
  findModel,
  isDownloaded,
} from "../lib/catalog.js";
import {
  CONFIG_FILE,
  type Config,
  DEFAULT_PORT,
  writeConfig,
} from "../lib/config.js";
import {
  download,
  ensureLms,
  installLmStudio,
  listDownloaded,
  load,
  startServer,
} from "../lib/lms.js";
import { cancelled } from "../lib/prompt.js";
import { UserError, readMachine } from "../lib/system.js";

const CORE = "core";

export interface SetupOptions {
  port?: number;
  yes: boolean;
  server: boolean;
}

/** Returns the config it wrote, so the caller can go straight on to launching. */
export async function runSetup(opts: SetupOptions): Promise<Config> {
  const port = opts.port ?? DEFAULT_PORT;
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
          hint: "LM Studio and its lms CLI — always installed",
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

  const spin = p.spinner();
  spin.start("Installing LM Studio");
  await installLmStudio();
  spin.message("Locating the lms CLI");
  const lms = await ensureLms();
  spin.stop(`LM Studio ready (${lms})`);

  const onDisk = listDownloaded(lms);
  const toDownload = models.filter((m) => !isDownloaded(onDisk, m.key));
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
      if (!go) throw new UserError("Stopped before downloading.");
    }
    for (const model of toDownload) {
      p.log.step(`Downloading ${model.label} (${model.sizeGb} GB)`);
      const ok = await download(lms, model.key);
      if (!ok)
        p.log.warn(
          `Could not download ${model.key}. Run: lms get ${model.key} --mlx`,
        );
    }
  } else {
    p.log.info("All selected models are already downloaded.");
  }

  const config: Config = {
    port,
    mainModel: mainModel.key,
    backgroundModel: backgroundModel.key,
    context: contextFor(mainModel, machine.ramGb),
  };
  writeConfig(config);
  p.log.success(`Wrote ${CONFIG_FILE}`);

  if (opts.server) {
    p.log.step(`Starting the server on port ${config.port}`);
    await startServer(lms, config.port);
    // Left to load on demand, LM Studio uses the model's default context, which
    // is usually far too small for Claude Code's prompts.
    p.log.step(
      `Loading ${mainModel.label} at ${config.context.toLocaleString()} tokens`,
    );
    await load(lms, config.mainModel, config.context);
  }

  return config;
}
