#!/usr/bin/env bun
/**
 * The task MCP server over HTTP, for every agent on the tailnet.
 *
 *   bun --env-file=<env> src/bin/tasks-server.ts [--port 7450] [--host <addr>]
 *
 * Reads TASKS_MCP_TOKEN, and DATABASE_URL or DASHBOARD_DB_PASSWORD, from the
 * environment. Binds to this machine's Tailscale address unless --host names
 * another, and refuses to start when there is none.
 */

import { readFileSync } from "node:fs";

import { connect, databaseUrl } from "../db.ts";
import { startRollup } from "../hoststats.ts";
import { parseScopedTokens, serve } from "../http.ts";
import { findTailnetAddress } from "../tailnet.ts";

const DEFAULT_PORT = 7450;

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const token = process.env.TASKS_MCP_TOKEN;
if (!token) {
  console.error(
    "TASKS_MCP_TOKEN is not set: generate one with openssl rand -hex 32",
  );
  process.exit(3);
}
const port = Number(arg("port") ?? process.env.TASKS_MCP_PORT ?? DEFAULT_PORT);
const host = arg("host") ?? process.env.TASKS_MCP_HOST ?? findTailnetAddress();
if (!host) {
  console.error("no Tailscale address on this machine: refusing to start");
  process.exit(4);
}

// TASKS_MCP_SCOPED_TOKENS names a JSON file of tokens limited to some
// clients, held as SHA-256 hashes only. See the README.
const scopedFile = process.env.TASKS_MCP_SCOPED_TOKENS;
const scopedTokens = scopedFile
  ? parseScopedTokens(readFileSync(scopedFile, "utf8"))
  : [];

const { db, close } = connect(databaseUrl());
const ctx = {
  db,
  now: () => new Date(),
  timeZone: process.env.TASKS_TIME_ZONE ?? "Europe/London",
};
const running = await serve(ctx, { host, port, scopedTokens, token });
// Fold and expire host statistics now and every hour. Nothing else schedules it.
const stopRollup = startRollup(ctx);
console.error(
  `tasks-server listening on http://${running.address.host}:${String(running.address.port)}/mcp` +
    (scopedTokens.length
      ? `, scoped tokens: ${scopedTokens.map((t) => t.name).join(", ")}`
      : ""),
);

const shutdown = () => {
  stopRollup();
  void running
    .close()
    .then(close)
    .then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
