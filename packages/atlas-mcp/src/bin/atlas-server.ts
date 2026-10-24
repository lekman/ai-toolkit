#!/usr/bin/env bun
/**
 * The Atlas task MCP server over HTTP, for every agent on the tailnet.
 *
 *   bun --env-file=<env> src/bin/atlas-server.ts [--port 7450] [--host <addr>]
 *
 * Reads ATLAS_MCP_TOKEN, and DATABASE_URL or DASHBOARD_DB_PASSWORD, from the
 * environment. Binds to this machine's Tailscale address unless --host names
 * another, and refuses to start when there is none.
 */

import { connect, databaseUrl } from "../db.ts";
import { serve } from "../http.ts";
import { findTailnetAddress } from "../tailnet.ts";

const DEFAULT_PORT = 7450;

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const token = process.env.ATLAS_MCP_TOKEN;
if (!token) {
  console.error(
    "ATLAS_MCP_TOKEN is not set: generate one with openssl rand -hex 32",
  );
  process.exit(3);
}
const port = Number(arg("port") ?? process.env.ATLAS_MCP_PORT ?? DEFAULT_PORT);
const host = arg("host") ?? process.env.ATLAS_MCP_HOST ?? findTailnetAddress();
if (!host) {
  console.error("no Tailscale address on this machine: refusing to start");
  process.exit(4);
}

const { db, close } = connect(databaseUrl());
const running = await serve(
  {
    db,
    now: () => new Date(),
    timeZone: process.env.ATLAS_TIME_ZONE ?? "Europe/London",
  },
  { host, port, token },
);
console.error(
  `atlas-server listening on http://${running.address.host}:${String(running.address.port)}/mcp`,
);

const shutdown = () => {
  void running
    .close()
    .then(close)
    .then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
