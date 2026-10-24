import type { IncomingMessage, Server } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import type { Context } from "./tasks.ts";

import { assertSafeBindHost } from "./tailnet.ts";
import { registerTaskTools } from "./tools.ts";

/** A started server: the address it bound, and a way to stop it. */
export interface RunningServer {
  address: { host: string; port: number };
  close: () => Promise<void>;
}

/** Options for serve. */
export interface ServeOptions {
  host: string;
  port: number;
  /** Every request to /mcp must carry `Authorization: Bearer <token>`. */
  token: string;
}

const MIN_TOKEN_LENGTH = 32;

/**
 * Serve the task tools over streamable HTTP at /mcp, with GET /health for
 * monitoring. Stateless: each request gets its own MCP server and transport,
 * while the database connection is shared.
 *
 * The server refuses a wildcard bind and a short token, because it can write
 * to client-confidential items.
 */
export async function serve(
  ctx: Context,
  options: ServeOptions,
): Promise<RunningServer> {
  assertSafeBindHost(options.host);
  if (options.token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `the token must be at least ${MIN_TOKEN_LENGTH} characters, for example from: openssl rand -hex 32`,
    );
  }
  const expected = digest(options.token);

  const http = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        return;
      }
      if (path !== "/mcp") {
        res.writeHead(404).end();
        return;
      }
      if (!authorised(req, expected)) {
        res
          .writeHead(401, { "www-authenticate": "Bearer" })
          .end("missing or wrong bearer token");
        return;
      }
      const server = new McpServer({ name: "tasks", version: "0.1.0" });
      registerTaskTools(server, ctx);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, await readJson(req));
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
  return {
    address:
      bound && typeof bound === "object"
        ? { host: bound.address, port: bound.port }
        : { host: options.host, port: options.port },
    close: () =>
      new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function authorised(req: IncomingMessage, expected: Buffer): boolean {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  return match ? timingSafeEqual(digest(match[1]!), expected) : false;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}
