/** Value types for the Atlas view. */

/** How to start the local MCP server the Atlas page calls `host:dashboard`. */
export interface HostServer {
  args: string[];
  command: string;
  env?: Record<string, string>;
}

/** An error the page understands, in the shape the artifact runtime uses. */
export interface RuntimeError {
  /** One of the runtime's codes, e.g. `not_granted`, `server_not_connected`, `tool_error`. */
  code: string;
  message?: string;
}

/** A request from the page's runtime stand-in, checked and typed. */
export type AtlasRequest =
  | {
      args: Record<string, unknown>;
      id: number;
      kind: "callTool";
      server: string;
      tool: string;
    }
  | { data: unknown; id: number; kind: "dbSet"; path: string }
  | { id: number; kind: "dbDelete"; path: string }
  | { id: number; kind: "dbGet"; path: string };

/** What the page needs at render time. */
export interface AtlasPageOptions {
  /** The webview's own source, for the content security policy. */
  cspSource: string;
  /**
   * The page's client key to open on, e.g. `acme`, or null to keep the page's
   * own remembered choice.
   */
  focus: null | string;
  /** A fresh nonce; every script on the page gets it. */
  nonce: string;
}
