import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { z } from "zod";

import type { IEmbeddingsProvider } from "../embeddings";
import type { TierName } from "../model";
import type { IChunkStore } from "../store";

import { SearchHandlers } from "./handlers";

/**
 * The three tool names this system exposes, in registration order.
 *
 * Exported so a test can assert the surface rather than trusting it: the
 * tailnet server is required to be READ-ONLY, and "read-only" is only
 * meaningful if something checks that nothing else ever appears here.
 */
export const SEARCH_TOOL_NAMES = [
  "search_notes",
  "get_note",
  "list_recent",
] as const;

const asText = (payload: unknown) => ({
  content: [{ text: JSON.stringify(payload, null, 2), type: "text" as const }],
});

/**
 * Register the search tool surface on an MCP server.
 *
 * Shared by both transports on purpose. The stdio server and the tailnet HTTP
 * server must not be able to drift apart: a tool present on one and missing
 * from the other would make a query answer differently depending on which
 * machine served it, which is exactly the class of inconsistency the parity
 * acceptance criterion exists to catch. One registration, two transports.
 *
 * Every tool here reads. Nothing mutates the store, and nothing writes to the
 * vault — indexing is the indexer's job and it is a separate process.
 */
export function registerSearchTools(
  server: McpServer,
  store: IChunkStore,
  embeddings: IEmbeddingsProvider,
): void {
  server.registerTool(
    "search_notes",
    {
      description:
        "Semantic search over the indexed knowledge base (Obsidian notes). " +
        "Returns the most relevant chunks with their note path and heading context. " +
        "Use for 'what do I know about X' questions; use get_note to read a full note after a hit.",
      inputSchema: {
        client: z
          .string()
          .optional()
          .describe("Filter by client name from note frontmatter"),
        include_archived: z
          .boolean()
          .optional()
          .describe("Include archived notes (default false)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Max results, default 8"),
        query: z.string().describe("Natural-language search query"),
        tier: z
          .enum(["private", "private-business", "shared-business"])
          .optional(),
        type: z
          .string()
          .optional()
          .describe("Filter by note type, e.g. meeting, strategy"),
      },
    },
    async (args) => {
      const results = await SearchHandlers.search(
        store,
        embeddings,
        args.query,
        {
          client: args.client,
          includeArchived: args.include_archived,
          tier: args.tier as TierName | undefined,
          type: args.type,
        },
        args.limit ?? 8,
      );
      return asText(
        results.map((hit) => ({
          heading: hit.chunk.headingPath,
          path: hit.chunk.path,
          score: Number(hit.score.toFixed(4)),
          text: hit.chunk.text,
        })),
      );
    },
  );

  server.registerTool(
    "get_note",
    {
      description:
        "Read a full indexed note by its vault-relative path (as returned by search_notes).",
      inputSchema: { path: z.string().describe("Vault-relative note path") },
    },
    async (args) => {
      const doc = await SearchHandlers.getDocument(store, args.path);
      return asText(doc ?? { error: `not indexed: ${args.path}` });
    },
  );

  server.registerTool(
    "list_recent",
    {
      description: "List the most recently modified indexed notes.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max entries, default 10"),
      },
    },
    async (args) =>
      asText(await SearchHandlers.listRecent(store, args.limit ?? 10)),
  );
}
