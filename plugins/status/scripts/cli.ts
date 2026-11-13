#!/usr/bin/env bun
/**
 * status: check whether the services you depend on are in an outage, from
 * each provider's official status feed and HTTP probes of your own endpoints.
 *
 * Usage:
 *   bun cli.ts [--only <words>] [--json] [--config <file>] [--timeout <ms>]
 *   bun cli.ts --list
 *
 * --only     Check only services whose names contain one of these
 *            comma-separated words, such as --only microsoft,github.
 * --json     Print the results as JSON instead of the text report.
 * --config   The services file. Default: $STATUS_CONFIG, then
 *            ~/.config/status/services.json, then the example beside this
 *            script.
 * --timeout  Per-request timeout in milliseconds. Default 8000.
 * --list     Print the configured services and the feed each one reads.
 *
 * Exit codes: 0 nothing affected; 1 a service is degraded or in an outage;
 * 2 bad arguments or services file; 3 nothing affected, but a feed couldn't be
 * read.
 */

import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { StatusCheck } from "./check.ts";
import { StatusConfigReader } from "./config.ts";
import { StatusReport } from "./report.ts";
import { configPath, HttpFetcher, readText } from "./status.system.ts";

const EXAMPLE = join(dirname(import.meta.path), "..", "services.example.json");

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({
      options: {
        config: { type: "string" },
        json: { default: false, type: "boolean" },
        list: { default: false, type: "boolean" },
        only: { type: "string" },
        timeout: { default: "8000", type: "string" },
      },
      strict: true,
    }).values;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const timeoutMs = Number(args.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 500) {
    console.error("--timeout must be a number of milliseconds, 500 or more");
    return 2;
  }
  const path = configPath(args.config) ?? EXAMPLE;
  if (args.config && path !== args.config) {
    console.error(`no services file at ${args.config}`);
    return 2;
  }
  if (path === EXAMPLE)
    console.error(
      `No services file; using the example. Copy it to ~/.config/status/services.json and edit it.`,
    );
  let services;
  try {
    const config = StatusConfigReader.parse(readText(path));
    services = StatusConfigReader.filter(config, (args.only ?? "").split(","));
  } catch (error) {
    console.error(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
  if (services.length === 0) {
    console.error(`no service in ${path} matches --only ${args.only}`);
    return 2;
  }
  if (args.list) {
    for (const s of services)
      console.log(`${s.name}\t${s.kind}\t${StatusCheck.feedUrl(s)}`);
    return 0;
  }
  const now = new Date();
  const results = await StatusCheck.run(services, new HttpFetcher(), {
    now,
    timeoutMs,
  });
  console.log(
    args.json
      ? JSON.stringify({ checkedAt: now.toISOString(), results }, null, 2)
      : StatusReport.text(results, now),
  );
  return StatusReport.exitCode(results);
}

process.exit(await main());
