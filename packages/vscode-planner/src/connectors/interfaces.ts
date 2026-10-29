/** Port interfaces for the direct connectors. */

import type { Credential } from "./types.ts";

/** Supplies the credential each API needs. */
export interface ICredentials {
  /**
   * @param credential - Which credential.
   * @returns The token, or null when none is set up.
   */
  token(credential: Credential): Promise<null | string>;
}

/** Answers a connector tool call by calling the service's API directly. */
export interface IConnectors {
  /**
   * @param server - The connector name the page used, e.g. `GitHub`.
   * @param tool - The connector's tool name.
   * @param args - The tool's arguments.
   * @returns The result, or null when no direct connector covers the call.
   */
  call(
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ): null | Promise<unknown>;
}
