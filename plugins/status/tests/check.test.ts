import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { IFetcher } from "../scripts/interfaces.ts";
import type { FetchedResponse, Service } from "../scripts/types.ts";

import { StatusCheck } from "../scripts/check.ts";
import { StatusConfigReader } from "../scripts/config.ts";
import { StatusReport } from "../scripts/report.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", name)));

/** Answers from a map of URL to response or error, and counts requests. */
class FakeFetcher implements IFetcher {
  calls: string[] = [];
  constructor(
    private readonly answers: Record<string, Error | FetchedResponse>,
  ) {}
  async get(url: string): Promise<FetchedResponse> {
    this.calls.push(url);
    const answer = this.answers[url];
    if (!answer) throw new Error(`no answer for ${url}`);
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

const options = { now: new Date("2026-11-13T09:00:00Z"), timeoutMs: 1000 };

describe("StatusCheck.run", () => {
  test("services that share a feed share one request, and keep their order", async () => {
    const consumer = "https://status.cloud.microsoft/api/posts/m365Consumer";
    const fetcher = new FakeFetcher({
      [consumer]: { body: fixture("microsoft-consumer.json"), status: 200 },
    });
    const services: Service[] = [
      {
        components: ["Microsoft 365 (Consumer)"],
        feed: "m365Consumer",
        kind: "microsoft",
        name: "Outlook.com",
      },
      {
        components: ["Microsoft Copilot"],
        feed: "m365Consumer",
        kind: "microsoft",
        name: "Copilot",
      },
    ];
    const results = await StatusCheck.run(services, fetcher, options);
    expect(fetcher.calls).toEqual([consumer]);
    expect(results.map((r) => [r.name, r.level])).toEqual([
      ["Outlook.com", "degraded"],
      ["Copilot", "ok"],
    ]);
  });

  test("a feed that fails is unknown, and the other services still report", async () => {
    const fetcher = new FakeFetcher({
      "https://status.example.com/api/v2/summary.json": new Error("timed out"),
      "https://www.githubstatus.com/api/v2/summary.json": {
        body: fixture("statuspage-ok.json"),
        status: 200,
      },
    });
    const results = await StatusCheck.run(
      [
        {
          kind: "statuspage",
          name: "Example",
          url: "https://status.example.com",
        },
        {
          kind: "statuspage",
          name: "GitHub",
          url: "https://www.githubstatus.com/",
        },
      ],
      fetcher,
      options,
    );
    expect(results[0]?.level).toBe("unknown");
    expect(results[0]?.summary).toContain("timed out");
    expect(results[1]?.level).toBe("ok");
    expect(StatusReport.exitCode(results)).toBe(3);
  });

  test("a feed that answers an error status is unknown, not ok", async () => {
    const fetcher = new FakeFetcher({
      "https://status.cloud.microsoft/api/posts/mac": {
        body: new Uint8Array(),
        status: 503,
      },
    });
    const [r] = await StatusCheck.run(
      [{ feed: "mac", kind: "microsoft", name: "M365" }],
      fetcher,
      options,
    );
    expect(r?.level).toBe("unknown");
    expect(r?.summary).toContain("HTTP 503");
  });

  test("an HTTP probe that gets no answer is an outage", async () => {
    const fetcher = new FakeFetcher({
      "http://127.0.0.1:9/health": new Error("connection refused"),
    });
    const [r] = await StatusCheck.run(
      [{ kind: "http", name: "Mine", url: "http://127.0.0.1:9/health" }],
      fetcher,
      options,
    );
    expect(r?.level).toBe("outage");
    expect(StatusReport.exitCode(r ? [r] : [])).toBe(1);
  });
});

describe("StatusConfigReader", () => {
  test("the shipped example is valid", () => {
    const text = readFileSync(
      join(import.meta.dir, "..", "services.example.json"),
      "utf-8",
    );
    expect(StatusConfigReader.parse(text).services.length).toBeGreaterThan(0);
  });

  test("rejects a missing list, an unknown kind, a missing url or feed, and a repeated name", () => {
    const parse = (value: unknown) => () =>
      StatusConfigReader.parse(JSON.stringify(value));
    expect(parse({})).toThrow("non-empty");
    expect(parse({ services: [{ kind: "rss", name: "A" }] })).toThrow(
      "kind must be",
    );
    expect(parse({ services: [{ kind: "statuspage", name: "A" }] })).toThrow(
      "url",
    );
    expect(parse({ services: [{ kind: "microsoft", name: "A" }] })).toThrow(
      "feed",
    );
    expect(
      parse({
        services: [
          { feed: "mac", kind: "microsoft", name: "A" },
          { feed: "azure", kind: "microsoft", name: "a" },
        ],
      }),
    ).toThrow("twice");
    expect(() => StatusConfigReader.parse("not json")).toThrow("not JSON");
  });

  test("--only matches name words, case-insensitive", () => {
    const config = StatusConfigReader.parse(
      JSON.stringify({
        services: [
          { feed: "mac", kind: "microsoft", name: "Microsoft 365" },
          {
            kind: "statuspage",
            name: "GitHub",
            url: "https://www.githubstatus.com",
          },
        ],
      }),
    );
    expect(
      StatusConfigReader.filter(config, ["micro"]).map((s) => s.name),
    ).toEqual(["Microsoft 365"]);
    expect(StatusConfigReader.filter(config, [""])).toHaveLength(2);
  });
});

describe("StatusReport", () => {
  test("lists every service, details the affected ones, and counts them", () => {
    const text = StatusReport.text(
      [
        {
          incidents: [],
          kind: "statuspage",
          level: "ok",
          name: "GitHub",
          source: "https://www.githubstatus.com",
          summary: "All Systems Operational",
        },
        {
          incidents: [{ status: "Service degradation", title: "Mail down" }],
          kind: "microsoft",
          level: "outage",
          name: "Microsoft 365",
          source: "https://status.cloud.microsoft/",
          summary: "Mail down",
        },
      ],
      new Date("2026-11-13T09:00:00Z"),
    );
    expect(text).toContain("Service status at 2026-11-13 09:00 UTC");
    expect(text).toContain(
      "Microsoft 365 (OUTAGE): https://status.cloud.microsoft/",
    );
    expect(text).toContain("- Mail down [Service degradation]");
    expect(text).toContain("1 OUTAGE of 2 services");
  });

  test("exit codes: 0 all ok or maintenance, 1 degraded or outage, 3 only unknown", () => {
    const r = (
      level: "degraded" | "maintenance" | "ok" | "outage" | "unknown",
    ) => ({
      incidents: [],
      kind: "http" as const,
      level,
      name: level,
      source: "",
      summary: "",
    });
    expect(StatusReport.exitCode([r("ok"), r("maintenance")])).toBe(0);
    expect(StatusReport.exitCode([r("ok"), r("degraded")])).toBe(1);
    expect(StatusReport.exitCode([r("unknown"), r("outage")])).toBe(1);
    expect(StatusReport.exitCode([r("ok"), r("unknown")])).toBe(3);
  });
});
