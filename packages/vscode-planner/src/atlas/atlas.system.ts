/** Process and filesystem adapters for the Atlas view. */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { IDocStore, IToolHost } from "./interfaces.ts";
import type { HostServer, RuntimeError } from "./types.ts";

/** Longest a tool call may take. `sync_now` runs three sync scripts. */
const CALL_TIMEOUT_MS = 180_000;

/** Reads the files the Atlas view is built from. */
export class AtlasFiles {
  /**
   * The parsed Claude desktop config, which declares the local MCP server.
   *
   * @returns The config, or null when it is missing or unreadable.
   */
  static desktopConfig(): unknown {
    const path = join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
    try {
      return JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      return null;
    }
  }

  /**
   * @param path - Absolute path to a file.
   * @returns Its modification time in milliseconds, or null when it is missing.
   */
  static modifiedAt(path: string): null | number {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  }

  /**
   * @param path - Absolute path to the page.
   * @returns The page source, or null when it cannot be read.
   */
  static readPage(path: string): null | string {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }
}

/**
 * The page's data store, kept in one JSON file.
 *
 * The artifact's own store lives on claude.ai and VS Code cannot reach it, so
 * this one is local. The page writes the results it fetches here, as it does
 * in the artifact, so a reload shows the last answers before the next fetch.
 */
export class FileDocStore implements IDocStore {
  private docs: null | Record<string, unknown> = null;

  /** @param path - The JSON file. Created on the first write. */
  constructor(private readonly path: string) {}

  /** @param path - The document to remove. */
  delete(path: string): void {
    const docs = this.load();
    if (!(path in docs)) return;
    delete docs[path];
    this.save();
  }

  /**
   * @param path - The document to read.
   * @returns Its data, or null when there is none.
   */
  get(path: string): unknown {
    return this.load()[path] ?? null;
  }

  /**
   * @param path - The document to write.
   * @param data - Its new data, replacing the old.
   */
  set(path: string, data: unknown): void {
    this.load()[path] = data;
    this.save();
  }

  private load(): Record<string, unknown> {
    if (this.docs) return this.docs;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      this.docs =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      this.docs = {};
    }
    return this.docs;
  }

  // Written to a temporary file and renamed, so a crash mid-write leaves the
  // old store rather than half a file.
  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.docs), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

/**
 * The local MCP server, over stdio, started on the first call.
 *
 * It is the same process the Claude desktop app starts for the artifact:
 * newline-delimited JSON-RPC, one `initialize`, then `tools/call`. If it
 * exits, every waiting call fails with `server_not_connected`, and the next
 * call starts it again.
 */
export class StdioToolHost implements IToolHost {
  private buffer = "";
  private next = 0;
  private readonly pending = new Map<
    number,
    { fail: (error: RuntimeError) => void; ok: (result: unknown) => void }
  >();
  private process: ChildProcessWithoutNullStreams | null = null;
  private ready: null | Promise<void> = null;

  /** @param server - How to start the server, or null when none is configured. */
  constructor(private readonly server: HostServer | null) {}

  /**
   * @param tool - The tool name.
   * @param args - The tool's arguments.
   * @returns The MCP `tools/call` result.
   */
  async callTool(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    await this.start();
    return this.send("tools/call", { arguments: args, name: tool });
  }

  /** Stop the server process. The next call starts it again. */
  dispose(): void {
    this.process?.kill();
    this.process = null;
    this.ready = null;
  }

  private fail(error: RuntimeError): void {
    for (const call of this.pending.values()) call.fail(error);
    this.pending.clear();
    this.process = null;
    this.ready = null;
    this.buffer = "";
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let end = this.buffer.indexOf("\n");
    while (end >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      end = this.buffer.indexOf("\n");
      if (!line) continue;
      let message: {
        error?: { message?: string };
        id?: number;
        result?: unknown;
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const call = this.pending.get(message.id);
      if (!call) continue;
      this.pending.delete(message.id);
      if (message.error) {
        call.fail({ code: "tool_error", message: message.error.message ?? "" });
      } else {
        call.ok(message.result);
      }
    }
  }

  private send(method: string, params: unknown): Promise<unknown> {
    const child = this.process;
    if (!child) {
      return Promise.reject({ code: "server_not_connected" } as RuntimeError);
    }
    const id = ++this.next;
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        fail({ code: "upstream_error", message: `${method} timed out` });
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, {
        fail: (error) => {
          clearTimeout(timer);
          fail(error);
        },
        ok: (result) => {
          clearTimeout(timer);
          ok(result);
        },
      });
      child.stdin.write(
        JSON.stringify({ id, jsonrpc: "2.0", method, params }) + "\n",
      );
    });
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const server = this.server;
    if (!server) {
      return Promise.reject({
        code: "server_not_connected",
        message: "No local dashboard server is configured.",
      } as RuntimeError);
    }

    const child = spawn(server.command, server.args, {
      env: { ...process.env, ...server.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
    // The server logs to stderr; reading it keeps the pipe from filling.
    child.stderr.on("data", () => {});
    // A write after the process died raises EPIPE here; the exit handler
    // already failed the waiting calls.
    child.stdin.on("error", () => {});
    child.on("error", () => this.fail({ code: "server_not_connected" }));
    child.on("exit", () => {
      if (this.process === child) this.fail({ code: "server_not_connected" });
    });

    this.ready = this.send("initialize", {
      capabilities: {},
      clientInfo: { name: "vscode-planner", version: "1" },
      protocolVersion: "2025-06-18",
    }).then(() => {
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n",
      );
    });
    this.ready.catch(() => {
      if (this.process === child) child.kill();
    });
    return this.ready;
  }
}
