/** Port interfaces for the Atlas view. */

/** Calls tools on the local MCP server the page knows as `host:dashboard`. */
export interface IToolHost {
  /**
   * Call one tool.
   *
   * @param tool - The tool name.
   * @param args - The tool's arguments.
   * @returns The MCP `tools/call` result, unchanged.
   * @throws A {@link RuntimeError}-shaped object when the server cannot answer.
   */
  callTool(tool: string, args: Record<string, unknown>): Promise<unknown>;

  /** Stop the server process, if one is running. */
  dispose(): void;
}

/** The page's data store: JSON documents by path. */
export interface IDocStore {
  delete(path: string): void;
  get(path: string): unknown;
  set(path: string, data: unknown): void;
}
