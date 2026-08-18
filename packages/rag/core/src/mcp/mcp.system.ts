import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { IEmbeddingsProvider } from "../embeddings";
import type { IChunkStore } from "../store";

import { registerSearchTools } from "./tools";

/** Stdio MCP server exposing the search tools. Wiring only — no logic. */
export class McpStdioServer {
  /** Build the server and connect it to stdio. Resolves when connected. */
  static async serve(
    store: IChunkStore,
    embeddings: IEmbeddingsProvider,
  ): Promise<void> {
    const server = new McpServer({ name: "rag", version: "0.1.0" });
    registerSearchTools(server, store, embeddings);
    await server.connect(new StdioServerTransport());
  }
}
