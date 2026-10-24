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
  /**
   * Further tokens, each limited to some clients, for machines that must not
   * see every client. Only the SHA-256 of each token is held here.
   */
  scopedTokens?: readonly ScopedToken[];
}

/** A token that reads and writes only the named clients. */
export interface ScopedToken {
  /** Who holds it, for logs, for example `acme-laptop`. */
  name: string;
  /** The SHA-256 of the token, as 64 hex characters. */
  sha256: string;
  /** The client ids it may read and write. */
  clients: readonly string[];
}

/** Parse and check the scoped-token file's JSON: an array of ScopedToken. */
export function parseScopedTokens(json: string): ScopedToken[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value))
    throw new Error("scoped tokens: expected a JSON array");
  return value.map((entry: unknown, i) => {
    const e = entry as Partial<ScopedToken>;
    const ok =
      typeof e.name === "string" &&
      e.name.length > 0 &&
      typeof e.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(e.sha256) &&
      Array.isArray(e.clients) &&
      e.clients.length > 0 &&
      e.clients.every(
        (c) => typeof c === "string" && /^[a-z0-9][a-z0-9-]*$/.test(c),
      );
    if (!ok) {
      throw new Error(
        `scoped tokens: entry ${i} needs a name, a 64-hex sha256 and at least one client id`,
      );
    }
    return { name: e.name!, sha256: e.sha256!, clients: [...e.clients!] };
  });
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
  const scoped = (options.scopedTokens ?? []).map((t) => ({
    clients: t.clients,
    digest: Buffer.from(t.sha256, "hex"),
  }));

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
      const access = authorise(req, expected, scoped);
      if (!access) {
        res
          .writeHead(401, { "www-authenticate": "Bearer" })
          .end("missing or wrong bearer token");
        return;
      }
      const server = new McpServer({ name: "tasks", version: "0.1.0" });
      registerTaskTools(
        server,
        access === "all" ? ctx : { ...ctx, scope: access },
      );
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

/** "all" for the main token, the clients of a scoped token, or null. */
function authorise(
  req: IncomingMessage,
  expected: Buffer,
  scoped: { clients: readonly string[]; digest: Buffer }[],
): "all" | readonly string[] | null {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return null;
  const presented = digest(match[1]!);
  if (timingSafeEqual(presented, expected)) return "all";
  // Check every entry, so the time taken does not say which one matched.
  let found: readonly string[] | null = null;
  for (const t of scoped) {
    if (timingSafeEqual(presented, t.digest) && !found) found = t.clients;
  }
  return found;
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
