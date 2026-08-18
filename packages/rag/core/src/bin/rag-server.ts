#!/usr/bin/env node
/**
 * Always-on MCP server: `rag-server --data <dir> [--port 7777] [--host <addr>]`.
 *
 * Serves search_notes / get_note / list_recent over streamable HTTP, bound to
 * this machine's Tailscale address ONLY. It refuses to start rather than bind
 * anywhere else: the index is the whole vault, and the design forbids it ever
 * being reachable from the LAN or the public internet.
 *
 * VOYAGE_API_KEY is required, because answering a search means embedding the
 * query.
 */

import { VoyageEmbeddings } from "../embeddings";
import { McpHttpServer } from "../mcp";
import { findTailnetAddress } from "../mcp/tailnet.system";
import { LanceDbChunkStore } from "../store";

const DEFAULT_PORT = 7777;

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const data = arg("data") ?? process.env["RAG_DATA"];
const apiKey = process.env["VOYAGE_API_KEY"];
const port = Number(arg("port") ?? process.env["RAG_PORT"] ?? DEFAULT_PORT);

if (!data) {
  console.error("usage: rag-server --data <dir> [--port 7777] [--host <addr>]");
  process.exit(2);
}
if (!apiKey) {
  console.error("VOYAGE_API_KEY is not set — cannot embed queries.");
  process.exit(3);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`invalid --port: ${String(port)}`);
  process.exit(2);
}

// An explicit --host is honoured (the tests bind 127.0.0.1), but the default
// is discovery, and discovery failing is fatal rather than a fallback.
const host = arg("host") ?? findTailnetAddress();

if (!host) {
  console.error(
    "no Tailscale address found on this machine — refusing to start.\n" +
      "This server binds to the tailnet only. Bring Tailscale up, or pass " +
      "--host explicitly if you know what you are doing.",
  );
  process.exit(4);
}

const running = await McpHttpServer.serve(
  new LanceDbChunkStore(data),
  new VoyageEmbeddings(apiKey),
  { host, port },
);

console.error(
  `rag-server listening on http://${running.address.host}:${String(running.address.port)} (tailnet only)`,
);

const shutdown = () => {
  void running.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
