/** Port interfaces for the status check. */

import type { FetchedResponse } from "./types.ts";

/** Fetches a URL with GET. */
export interface IFetcher {
  /**
   * @param url - The URL to request.
   * @param timeoutMs - Give up after this many milliseconds.
   * @returns The status code and body. Rejects on a network failure or timeout.
   */
  get(url: string, timeoutMs: number): Promise<FetchedResponse>;
}
