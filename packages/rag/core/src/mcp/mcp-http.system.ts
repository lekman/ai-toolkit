import type { Server } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";

import type { IEmbeddingsProvider } from "../embeddings";
import type { IChunkStore } from "../store";

import { assertSafeBindHost } from "./tailnet";
import { registerSearchTools } from "./tools";

/** What a started server exposes, so a caller can probe and stop it. */
export interface RunningHttpServer {
  /** The address actually bound, read back from the socket, not the input. */
  address: { host: string; port: number };
  /** Stop listening and resolve once closed. */
  close: () => Promise<void>;
}

/**
 * Streamable-HTTP MCP server for the always-on index.
 *
 * Read-only by construction: it registers exactly the shared search tools and
 * holds no write path to the store. Transport is the only thing that differs
 * from the stdio server.
 */
export class McpHttpServer {
  /**
   * Bind to ONE interface and serve MCP over streamable HTTP.
   *
   * `host` must be a specific address — in production the machine's Tailscale
   * address. Wildcards are refused, see assertSafeBindHost.
   */
  static async serve(
    store: IChunkStore,
    embeddings: IEmbeddingsProvider,
    options: { host: string; port: number },
  ): Promise<RunningHttpServer> {
    assertSafeBindHost(options.host);

    const http = createServer((req, res) => {
      void (async () => {
        // A fresh server and transport per request: this is the SDK's
        // stateless mode, where no session id is issued and each request must
        // therefore carry its own initialization. Reusing one pair across
        // requests looks cheaper but leaves the second request talking to a
        // transport that considers the exchange already finished, which
        // surfaces as an empty reply rather than an error.
        //
        // Only the thin MCP wiring is rebuilt; the store, its open LanceDB
        // handle and the embeddings client are shared and long-lived.
        const server = new McpServer({ name: "rag", version: "0.1.0" });
        registerSearchTools(server, store, embeddings);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        try {
          await server.connect(transport);
          const body = await readJsonBody(req);
          await transport.handleRequest(req, res, body);
        } catch {
          if (!res.headersSent) res.writeHead(400).end();
          else res.end();
        } finally {
          await transport.close().catch(() => undefined);
          await server.close().catch(() => undefined);
        }
      })();
    });

    await listen(http, options.host, options.port);

    const bound = http.address();
    const address =
      bound && typeof bound === "object"
        ? { host: bound.address, port: bound.port }
        : { host: options.host, port: options.port };

    return {
      address,
      close: () =>
        new Promise<void>((resolve, reject) => {
          http.close((error) => (error ? reject(error) : resolve()));
        }),
    };
  }
}

/** Read and parse a JSON request body; undefined when there is no body. */
async function readJsonBody(req: {
  [Symbol.asyncIterator]: () => AsyncIterator<Buffer | string>;
  method?: string | undefined;
}): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Promisified listen that rejects rather than emitting an unhandled error. */
function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
}
