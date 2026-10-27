/**
 * The Atlas view: the same page the Claude artifact runs, hosted in a VS Code
 * webview.
 *
 * The page talks to its runtime through `window.claude.use("mcp" | "db")`. In
 * VS Code a small stand-in script provides that object and forwards each call
 * to the extension, which answers `host:dashboard` tool calls from the local
 * MCP server and data store calls from a file. Everything here is the pure
 * part of that: building the page, checking what the page sends, and turning
 * results into the runtime's shapes.
 */

import type {
  AtlasPageOptions,
  AtlasRequest,
  HostServer,
  RuntimeError,
  StorageScope,
} from "./types.ts";

import { Shim } from "./shim.ts";

/** The one server the extension can answer. The page calls it `host:dashboard`. */
const HOST = "host:dashboard";

/**
 * Store paths as the page writes them: `board/tasks`, `details/<key>`,
 * `prs/<key>`. Anything else is refused before it reaches the file.
 */
const DOC_PATH = /^[a-z0-9_.-]+(\/[a-z0-9_.-]+)*$/i;

/** `localStorage` keys as the page names them: `db.focus`, `db.view`. */
const STORAGE_KEY = /^[\w.:-]{1,100}$/;

/** The longest `localStorage` value kept. The page's are small JSON lists. */
const STORAGE_VALUE_MAX = 100_000;

/** The page's key for the chosen client. */
const FOCUS_KEY = "db.focus";

/**
 * Base rules the artifact host puts around every page, which the page relies
 * on. Without the `[hidden]` rule, an element whose own CSS sets `display`
 * stays visible when the page hides it, such as another client's tab.
 */
const BASE_STYLE =
  "body{margin:0;padding:0}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}";

/** Pure logic behind the Atlas view. */
export class Atlas {
  /**
   * The page's client key for this workspace, so the page opens on the
   * repository's client the way the Today and Tomorrow panes filter to it.
   *
   * The page keys clients by the first word of their name in lower case
   * (`Acme Consulting` is `acme`). It ignores a key it does not know, so a
   * wrong guess falls back to its own remembered choice.
   *
   * @param clients - The resolved client names for this workspace.
   * @returns The key, or null when there is not exactly one client.
   */
  static focusKey(clients: string[]): null | string {
    if (clients.length !== 1) return null;
    const first = clients[0]!.trim().split(/\s+/)[0] ?? "";
    const key = first.toLowerCase().replace(/[^a-z0-9]/g, "");
    return key || null;
  }

  /**
   * Read the `host:dashboard` server from the Claude desktop config, so VS
   * Code starts exactly what the desktop app starts.
   *
   * @param config - The parsed `claude_desktop_config.json`.
   * @param name - The server's key under `mcpServers`.
   * @returns The server, or null when it is missing or malformed.
   */
  static hostServer(config: unknown, name: string): HostServer | null {
    if (!isRecord(config) || !isRecord(config.mcpServers)) return null;
    const entry = config.mcpServers[name];
    if (!isRecord(entry) || typeof entry.command !== "string") return null;
    const args = Array.isArray(entry.args)
      ? entry.args.filter((a): a is string => typeof a === "string")
      : [];
    const env = isRecord(entry.env)
      ? Object.fromEntries(
          Object.entries(entry.env).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        )
      : undefined;
    return { args, command: entry.command, ...(env ? { env } : {}) };
  }

  /**
   * Whether a tool call is for the server the extension answers.
   *
   * @param server - The server name the page used.
   * @returns True for `host:dashboard`.
   */
  static isHost(server: string): boolean {
    return server === HOST;
  }

  /**
   * The error the page gets for a connector VS Code does not have.
   *
   * `not_granted` is the code the page already handles for a connector the
   * user has not allowed: the section stays empty and the rest of the page
   * works, which is what the artifact does outside the desktop app.
   *
   * @param server - The server name the page used.
   * @returns The error to answer with.
   */
  static notGranted(server: string): RuntimeError {
    return {
      code: "not_granted",
      message: `${server} is not available in VS Code.`,
    };
  }

  /**
   * Build the webview's HTML from the page source.
   *
   * The page is wrapped in a document the way the artifact host wraps it,
   * with a content security policy in front. Every script gets the nonce,
   * the runtime stand-in runs first, and the only remote sources allowed are
   * the ones the page loads: Google Fonts, and the Markdown libraries on
   * cdnjs. The page makes no network requests of its own; everything else
   * goes through the extension.
   *
   * @param source - The page's HTML, as published to the artifact.
   * @param options - Nonce, webview source and the client to open on.
   * @returns The HTML to set on the webview.
   */
  static page(source: string, options: AtlasPageOptions): string {
    const { cspSource, nonce, storage } = options;
    const csp = [
      "default-src 'none'",
      `img-src ${cspSource} https: data:`,
      `style-src ${cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src ${cspSource} https://fonts.gstatic.com data:`,
      `script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com`,
    ].join("; ");
    const body = source
      .replace(/^\s*<!doctype html>/i, "")
      .replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
    return [
      "<!doctype html>",
      '<html><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
      `<style>${BASE_STYLE}</style>`,
      `<script nonce="${nonce}">${Shim.script(storage)}</script>`,
      "</head><body>",
      body,
      "</body></html>",
    ].join("\n");
  }

  /**
   * Check a message from the webview and type it.
   *
   * The page is the user's own, but it renders text from trackers and other
   * agents, so its messages are checked rather than trusted. A store path
   * must look like one the page writes, and may not climb out with `..`.
   *
   * @param message - Whatever the webview posted.
   * @returns The request, or null when it is not one.
   */
  static request(message: unknown): AtlasRequest | null {
    if (!isRecord(message) || message.type !== "atlas") return null;
    const { id, kind } = message;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) {
      return null;
    }

    if (kind === "callTool") {
      const { args, server, tool } = message;
      if (!isName(server) || !isName(tool)) return null;
      if (args !== undefined && args !== null && !isRecord(args)) return null;
      return { args: args ?? {}, id, kind, server, tool };
    }

    if (kind === "storageSet") {
      const { key, value } = message;
      if (typeof key !== "string" || !STORAGE_KEY.test(key)) return null;
      if (value !== null && typeof value !== "string") return null;
      if (typeof value === "string" && value.length > STORAGE_VALUE_MAX) {
        return null;
      }
      return { id, key, kind, value };
    }

    if (kind !== "dbDelete" && kind !== "dbGet" && kind !== "dbSet")
      return null;
    const { path } = message;
    if (typeof path !== "string" || path.length > 300 || !DOC_PATH.test(path)) {
      return null;
    }
    if (path.split("/").some((part) => part === "." || part === "..")) {
      return null;
    }
    if (kind === "dbSet") return { data: message.data, id, kind, path };
    return { id, kind, path };
  }

  /**
   * Which state keeps a `localStorage` key.
   *
   * The chosen client belongs to the repository, as the Today and Tomorrow
   * panes' filter does, so it is kept per workspace. Everything else (tab,
   * band, folds, show done) is a personal preference kept for every window.
   *
   * @param key - The page's key.
   * @returns Where to keep it.
   */
  static storageScope(key: string): StorageScope {
    return key === FOCUS_KEY ? "workspace" : "global";
  }

  /**
   * The page's `localStorage` as it should start.
   *
   * The client is the one last chosen in this workspace; before any choice,
   * the repository's own client; without one, the last choice anywhere.
   *
   * @param global - The keys kept for every window.
   * @param workspaceFocus - The client last chosen in this workspace, or null.
   * @param repositoryFocus - The repository's client key, or null.
   * @returns The storage to hand the page.
   */
  static storageSnapshot(
    global: Record<string, string>,
    workspaceFocus: null | string,
    repositoryFocus: null | string,
  ): Record<string, string> {
    const focus =
      workspaceFocus ?? repositoryFocus ?? global[FOCUS_KEY] ?? null;
    return focus ? { ...global, [FOCUS_KEY]: focus } : { ...global };
  }

  /**
   * Turn a `tools/call` result into what the page receives.
   *
   * The artifact runtime fails a call whose result is marked `isError`, with
   * the tool's own text as the message, so the page's error paths run.
   *
   * @param result - The MCP result.
   * @returns The result to resolve with, or the error to reject with.
   */
  static toolOutcome(
    result: unknown,
  ): { error: RuntimeError } | { result: unknown } {
    if (!isRecord(result) || result.isError !== true) return { result };
    const text = Array.isArray(result.content)
      ? result.content
          .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : ""))
          .join(" ")
          .trim()
      : "";
    return {
      error: { code: "tool_error", message: text || "The tool failed." },
    };
  }
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
