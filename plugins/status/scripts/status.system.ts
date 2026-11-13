/** I/O for the status check: HTTP and the services file. No logic. */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { IFetcher } from "./interfaces.ts";
import type { FetchedResponse } from "./types.ts";

/** Fetches with Bun's fetch, following redirects. */
export class HttpFetcher implements IFetcher {
  /** @inheritdoc */
  async get(url: string, timeoutMs: number): Promise<FetchedResponse> {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "ai-toolkit-status/0.1 (+https://github.com/lekman/ai-toolkit)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      body: new Uint8Array(await response.arrayBuffer()),
      status: response.status,
    };
  }
}

/**
 * The services file to read: the given path, then `$STATUS_CONFIG`, then
 * `~/.config/status/services.json`. Undefined when none exists.
 * @param given - A path from the command line.
 * @returns The path, or undefined.
 */
export function configPath(given?: string): string | undefined {
  const candidates = [
    given,
    process.env.STATUS_CONFIG,
    join(homedir(), ".config", "status", "services.json"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p));
}

/**
 * Reads a text file.
 * @param path - The file.
 * @returns Its contents.
 */
export function readText(path: string): string {
  return readFileSync(path, "utf-8");
}
