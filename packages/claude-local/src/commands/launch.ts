/**
 * Start Claude Code against the local model.
 *
 * The environment is handed to the child process only. Nothing is exported
 * into your shell and nothing is written to a wrapper script, so an ordinary
 * `claude` in the same terminal still reaches the hosted model.
 */

import { spawn } from "node:child_process";
import * as p from "@clack/prompts";
import { type Config, claudeEnv } from "../lib/config.js";
import { findModel } from "../lib/catalog.js";
import {
  listLoaded,
  load,
  requireLms,
  serverRunning,
  startServer,
  unloadAll,
} from "../lib/lms.js";
import { UserError, which } from "../lib/system.js";

/** Bring the backend up to the point where Claude Code can talk to it. */
export async function ensureServing(config: Config): Promise<void> {
  const lms = requireLms();
  if (!(await serverRunning(config.port))) {
    p.log.step(`Starting the server on port ${config.port}`);
    await startServer(lms, config.port);
  }

  const loaded = listLoaded(lms);
  if (
    loaded.some(
      (k) => k.includes(config.mainModel) || config.mainModel.includes(k),
    )
  )
    return;

  const model = findModel(config.mainModel);
  p.log.step(`Loading ${model?.label ?? config.mainModel}`);
  // Something else may be resident from an earlier session. Free it rather than
  // stacking, which would push the machine into swap.
  if (loaded.length) unloadAll(lms);
  await load(lms, config.mainModel, config.context);
}

/**
 * Replace this process with Claude Code. `args` is passed through untouched, so
 * every Claude Code flag keeps working.
 */
export async function runLaunch(
  config: Config,
  args: string[],
): Promise<never> {
  if (!which("claude")) {
    throw new UserError(
      "Claude Code is not installed, or `claude` is not on your PATH.\n" +
        "Install it from https://claude.com/claude-code and try again.",
    );
  }

  await ensureServing(config);

  const child = spawn("claude", args, {
    stdio: "inherit",
    env: { ...process.env, ...claudeEnv(config) },
  });
  const code = await new Promise<number>((resolve) => {
    child.on("close", (c) => resolve(c ?? 0));
    child.on("error", () => resolve(1));
  });
  process.exit(code);
}
