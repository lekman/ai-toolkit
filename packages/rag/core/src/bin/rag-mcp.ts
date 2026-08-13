#!/usr/bin/env node
/**
 * Stdio MCP server: `rag-mcp --data <dir>`. Serves search_notes / get_note /
 * list_recent over the local store. VOYAGE_API_KEY is required to embed
 * queries.
 */

import { VoyageEmbeddings } from "../embeddings";
import { McpStdioServer } from "../mcp";
import { LanceDbChunkStore } from "../store";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const data = arg("data") ?? process.env["RAG_DATA"];
const apiKey = process.env["VOYAGE_API_KEY"];

if (!data) {
  console.error("usage: rag-mcp --data <dir>");
  process.exit(2);
}
if (!apiKey) {
  console.error("VOYAGE_API_KEY is not set — cannot embed queries.");
  process.exit(3);
}

await McpStdioServer.serve(
  new LanceDbChunkStore(data),
  new VoyageEmbeddings(apiKey),
);
