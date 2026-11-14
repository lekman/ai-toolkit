/** Checks every configured service at once and reads each feed. */

import type { IFetcher } from "./interfaces.ts";
import type { Service, ServiceResult } from "./types.ts";

import { type Reading, StatusParsers } from "./parsers.ts";

const MICROSOFT_PAGE = "https://status.cloud.microsoft/";
const GOOGLE_FEED =
  "https://www.google.com/appsstatus/dashboard/incidents.json";
const GOOGLE_PAGE = "https://www.google.com/appsstatus/dashboard/";
const AWS_FEED = "https://health.aws.amazon.com/public/currentevents";
const AWS_PAGE = "https://health.aws.amazon.com/health/status";

/** Pages that answer from almost anywhere, to tell "offline" from "every feed is down". */
export const CONNECTIVITY_URLS = [
  "https://captive.apple.com/hotspot-detect.html",
  "https://www.gstatic.com/generate_204",
];

/** Runs the checks. */
export class StatusCheck {
  /**
   * The feed URL a service is read from.
   * @param service - The service.
   * @returns The URL.
   */
  static feedUrl(service: Service): string {
    switch (service.kind) {
      case "aws":
        return AWS_FEED;
      case "google-workspace":
        return GOOGLE_FEED;
      case "http":
        return service.url;
      case "microsoft":
        return `https://status.cloud.microsoft/api/posts/${service.feed}`;
      case "statuspage":
        return `${service.url.replace(/\/+$/, "")}/api/v2/summary.json`;
    }
  }

  /**
   * Whether this machine can reach the internet: true when any connectivity
   * page answers with any status. Call it only when no service answered, to
   * tell a dead connection from many feeds failing at once.
   * @param fetcher - How to fetch.
   * @param timeoutMs - Per-request timeout.
   * @returns True when a connectivity page answered.
   */
  static async online(fetcher: IFetcher, timeoutMs: number): Promise<boolean> {
    const answers = await Promise.allSettled(
      CONNECTIVITY_URLS.map((url) => fetcher.get(url, timeoutMs)),
    );
    return answers.some((a) => a.status === "fulfilled");
  }

  /**
   * Checks every service. Services that share a feed share one request. A feed
   * that fails gives that service the level unknown, or outage for an HTTP
   * probe, without stopping the others.
   * @param services - The services, in report order.
   * @param fetcher - How to fetch.
   * @param options - The timeout and the time to judge open incidents against.
   * @param options.now - The current time.
   * @param options.timeoutMs - Per-request timeout.
   * @returns One result per service, in the same order.
   */
  static async run(
    services: Service[],
    fetcher: IFetcher,
    options: { now: Date; timeoutMs: number },
  ): Promise<ServiceResult[]> {
    const requests = new Map<string, ReturnType<IFetcher["get"]>>();
    const fetchOnce = (url: string) => {
      let pending = requests.get(url);
      if (!pending) {
        pending = fetcher.get(url, options.timeoutMs);
        requests.set(url, pending);
      }
      return pending;
    };
    return Promise.all(
      services.map(async (service): Promise<ServiceResult> => {
        const url = StatusCheck.feedUrl(service);
        const source = StatusCheck.pageUrl(service);
        const base = { kind: service.kind, name: service.name, source };
        const failed = (error: unknown, reached: boolean): ServiceResult => {
          const message =
            error instanceof Error ? error.message : String(error);
          const probe = service.kind === "http";
          return {
            ...base,
            error: message,
            incidents: [],
            level: probe ? "outage" : "unknown",
            reached,
            summary: probe
              ? `No answer: ${message}`
              : `Couldn't read the status feed: ${message}`,
          };
        };
        let response;
        try {
          response = await fetchOnce(url);
        } catch (error) {
          return failed(error, false);
        }
        try {
          const reading = StatusCheck.read(service, response, options.now);
          return { ...base, reached: true, ...reading };
        } catch (error) {
          return failed(error, true);
        }
      }),
    );
  }

  private static pageUrl(service: Service): string {
    switch (service.kind) {
      case "aws":
        return AWS_PAGE;
      case "google-workspace":
        return GOOGLE_PAGE;
      case "microsoft":
        return MICROSOFT_PAGE;
      case "http":
      case "statuspage":
        return service.url;
    }
  }

  private static read(
    service: Service,
    response: { body: Uint8Array; status: number },
    now: Date,
  ): Reading {
    if (service.kind === "http")
      return StatusParsers.http(response.status, service.expect);
    if (response.status < 200 || response.status >= 300)
      throw new Error(`the feed answered HTTP ${response.status}`);
    switch (service.kind) {
      case "aws":
        return StatusParsers.aws(response.body, service);
      case "google-workspace":
        return StatusParsers.googleWorkspace(response.body, service, now);
      case "microsoft":
        return StatusParsers.microsoft(response.body, service);
      case "statuspage":
        return StatusParsers.statuspage(response.body, service);
    }
  }
}
