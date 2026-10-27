/** Network, process and secret adapters for the direct connectors. */

import type * as vscode from "vscode";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import type { IConnectors, ICredentials } from "./interfaces.ts";
import type { ConnectorName, ConnectorRequest, Credential } from "./types.ts";

import {
  accessToken,
  CONFIG_PATH,
  TOKEN_PATH,
} from "../../../calendar/src/client.ts";
import { Connectors } from "./connectors.ts";

/** The SecretStorage key for the monday.com API token. */
export const MONDAY_SECRET = "atlas.mondayToken";

/** How long a token from `gh auth token` is reused. */
const GITHUB_TOKEN_MS = 10 * 60_000;

const run = promisify(execFile);

/**
 * Credentials from where each already lives.
 *
 * - GitHub: the token of the account `gh` is signed in to.
 * - Microsoft 365: the calendar package's cached sign-in, refreshed when it
 *   expires (`~/.claude/calendar-token.json`).
 * - monday.com: VS Code SecretStorage, which is the macOS Keychain, set with
 *   the "Atlas: Set monday.com Token" command.
 */
export class LocalCredentials implements ICredentials {
  private github: null | { at: number; token: string } = null;

  /** @param secrets - The extension's SecretStorage. */
  constructor(private readonly secrets: vscode.SecretStorage) {}

  /**
   * @param credential - Which credential.
   * @returns The token, or null when it is not set up on this machine.
   */
  async token(credential: Credential): Promise<null | string> {
    switch (credential) {
      case "github":
        return this.githubToken();
      case "microsoft":
        if (!existsSync(CONFIG_PATH) || !existsSync(TOKEN_PATH)) return null;
        return accessToken();
      case "monday":
        return (await this.secrets.get(MONDAY_SECRET)) ?? null;
    }
  }

  private async githubToken(): Promise<null | string> {
    if (this.github && Date.now() - this.github.at < GITHUB_TOKEN_MS) {
      return this.github.token;
    }
    // The extension host may not have the shell's PATH, so the usual
    // Homebrew locations are added.
    const path = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"]
      .filter(Boolean)
      .join(":");
    try {
      const { stdout } = await run("gh", ["auth", "token"], {
        env: { ...process.env, PATH: path },
        timeout: 10_000,
      });
      const token = stdout.trim();
      if (!token) return null;
      this.github = { at: Date.now(), token };
      return token;
    } catch {
      return null;
    }
  }
}

/** Answers connector calls with direct API requests. */
export class ConnectorHub implements IConnectors {
  /**
   * @param credentials - Supplies each API's token.
   * @param enabled - The connectors switched on in the settings, read per call.
   */
  constructor(
    private readonly credentials: ICredentials,
    private readonly enabled: () => ConnectorName[],
  ) {}

  /**
   * @param server - The connector name the page used.
   * @param tool - The tool name.
   * @param args - The tool's arguments.
   * @returns The result, or null when no direct connector covers the call.
   */
  call(
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ): null | Promise<unknown> {
    const name = Connectors.connector(server);
    if (!name || !this.enabled().includes(name)) return null;
    const request = Connectors.request(
      server,
      tool,
      args,
      -new Date().getTimezoneOffset(),
    );
    return request ? this.send(name, request) : null;
  }

  private async send(
    name: ConnectorName,
    request: ConnectorRequest,
  ): Promise<unknown> {
    let token: null | string;
    try {
      token = await this.credentials.token(request.credential);
    } catch (error) {
      throw Connectors.failure(name, 401, String(error));
    }
    if (!token) throw Connectors.missing(name);

    const response = await fetch(request.url, {
      body: request.body,
      headers: {
        ...request.headers,
        authorization: Connectors.authorization(request.credential, token),
        "user-agent": "vscode-planner",
      },
      method: request.method,
    });
    if (!response.ok) {
      throw Connectors.failure(name, response.status, await response.text());
    }
    return request.result(await response.json());
  }
}
