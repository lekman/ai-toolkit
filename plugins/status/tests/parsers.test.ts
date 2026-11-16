import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { StatusParsers } from "../scripts/parsers.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", name)));
const json = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

describe("decode", () => {
  test("reads UTF-16 big-endian with a byte order mark, as the AWS feed sends", () => {
    const text = StatusParsers.decode(fixture("aws-currentevents.bin"));
    expect(text.startsWith("[")).toBe(true);
  });

  test("reads UTF-16 little-endian and plain UTF-8", () => {
    const le = new Uint8Array([0xff, 0xfe, 0x5b, 0x00, 0x5d, 0x00]);
    expect(StatusParsers.decode(le)).toBe("[]");
    expect(StatusParsers.decode(json([]))).toBe("[]");
  });
});

describe("statuspage", () => {
  const page = {
    kind: "statuspage" as const,
    name: "X",
    url: "https://status.example.com/",
  };

  test("an all-operational page is ok with its own description", () => {
    const r = StatusParsers.statuspage(fixture("statuspage-ok.json"), page);
    expect(r.level).toBe("ok");
    expect(r.summary).toBe("All Systems Operational");
    expect(r.incidents).toEqual([]);
  });

  test("a minor indicator is degraded and lists the open incident", () => {
    const r = StatusParsers.statuspage(fixture("statuspage-claude.json"), page);
    expect(r.level).toBe("degraded");
    expect(r.incidents[0]?.title).toContain("Microsoft 365 connector");
  });

  test("named components decide the level, and an unaffected one is ok", () => {
    const r = StatusParsers.statuspage(fixture("statuspage-claude.json"), {
      ...page,
      components: ["Claude Code"],
    });
    expect(r.level).toBe("ok");
  });

  test("a degraded named component is degraded", () => {
    const r = StatusParsers.statuspage(fixture("statuspage-claude.json"), {
      ...page,
      components: ["claude.ai"],
    });
    expect(r.level).toBe("degraded");
  });

  test("a component name that is not on the page is reported", () => {
    const none = StatusParsers.statuspage(fixture("statuspage-ok.json"), {
      ...page,
      components: ["No such thing"],
    });
    expect(none.level).toBe("unknown");
    expect(none.error).toContain("No such thing");
    const some = StatusParsers.statuspage(fixture("statuspage-ok.json"), {
      ...page,
      components: ["API", "No such thing"],
    });
    expect(some.level).toBe("ok");
    expect(some.error).toContain("No such thing");
  });

  test("major_outage on a component is an outage; resolved incidents are dropped", () => {
    const body = json({
      components: [{ name: "API", status: "major_outage" }],
      incidents: [
        { name: "API down", status: "investigating" },
        { name: "Old", status: "resolved" },
      ],
      status: { indicator: "major" },
    });
    const r = StatusParsers.statuspage(body, { ...page, components: ["API"] });
    expect(r.level).toBe("outage");
    expect(r.incidents.map((i) => i.title)).toEqual(["API down"]);
  });
});

describe("microsoft", () => {
  const service = { feed: "mac", kind: "microsoft" as const, name: "M365" };

  test("a single degraded post is degraded, with the current status", () => {
    const r = StatusParsers.microsoft(fixture("microsoft-mac.json"), service);
    expect(r.level).toBe("degraded");
    expect(r.incidents[0]?.title).toContain("unable to connect");
    expect(r.summary).toContain("positive results");
  });

  test("Azure's Available is ok", () => {
    const r = StatusParsers.microsoft(fixture("microsoft-azure.json"), {
      ...service,
      feed: "azure",
    });
    expect(r.level).toBe("ok");
  });

  test("a list feed filters by service name", () => {
    const consumer = fixture("microsoft-consumer.json");
    expect(
      StatusParsers.microsoft(consumer, { ...service, feed: "m365Consumer" })
        .level,
    ).toBe("degraded");
    expect(
      StatusParsers.microsoft(consumer, {
        ...service,
        components: ["Microsoft Copilot"],
        feed: "m365Consumer",
      }).level,
    ).toBe("ok");
    expect(
      StatusParsers.microsoft(consumer, {
        ...service,
        components: ["Nothing like it"],
        feed: "m365Consumer",
      }).level,
    ).toBe("unknown");
  });

  test("tags are stripped from the message, nested ones too", () => {
    const r = StatusParsers.microsoft(
      json({
        Message:
          "<p>Current status:</p><div>Mail&nbsp;is <scr<b>ipt>back</div><br/>Scope of impact: all",
        Status: "Service degradation",
        Title: "Mail slow",
      }),
      service,
    );
    expect(r.summary).toContain("Mail is iptback");
    expect(r.summary).not.toMatch(/[<>]/);
  });

  test("an interruption is an outage", () => {
    const r = StatusParsers.microsoft(
      json({ Status: "Service interruption", Title: "Mail down" }),
      service,
    );
    expect(r.level).toBe("outage");
  });
});

describe("google workspace", () => {
  const service = { kind: "google-workspace" as const, name: "G" };
  const incidents = JSON.parse(
    readFileSync(
      join(import.meta.dir, "fixtures", "google-incidents.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>[];
  const now = new Date("2026-11-13T09:00:00Z");

  test("ended incidents are not open", () => {
    expect(
      StatusParsers.googleWorkspace(json(incidents), service, now).level,
    ).toBe("ok");
  });

  test("an incident with no end is open, filtered by product", () => {
    const open = incidents.map((i) =>
      i.service_name === "Google Drive" ? { ...i, end: null } : i,
    );
    const drive = StatusParsers.googleWorkspace(
      json(open),
      { ...service, products: ["Google Drive"] },
      now,
    );
    expect(drive.level).toBe("degraded");
    expect(drive.summary).toContain("Google Drive");
    expect(
      StatusParsers.googleWorkspace(
        json(open),
        { ...service, products: ["Gmail"] },
        now,
      ).level,
    ).toBe("ok");
  });

  test("SERVICE_OUTAGE is an outage", () => {
    const body = json([
      { end: null, service_name: "Gmail", status_impact: "SERVICE_OUTAGE" },
    ]);
    expect(StatusParsers.googleWorkspace(body, service, now).level).toBe(
      "outage",
    );
  });
});

describe("aws", () => {
  const body = fixture("aws-currentevents.bin");
  const service = { kind: "aws" as const, name: "AWS" };

  test("a region with no events is ok", () => {
    expect(
      StatusParsers.aws(body, { ...service, regions: ["eu-west-1"] }).level,
    ).toBe("ok");
  });

  test("an event in the region is read, and status 3 is an outage", () => {
    const r = StatusParsers.aws(body, {
      ...service,
      regions: ["me-central-1"],
    });
    expect(r.level).toBe("outage");
    expect(r.incidents).toHaveLength(1);
    expect(r.incidents[0]?.title).toContain("UAE");
  });

  test("service codes narrow events by prefix", () => {
    const events = json([
      {
        region_name: "Ireland",
        service: "ec2-eu-west-1",
        status: "2",
        summary: "Increased errors",
      },
      {
        region_name: "Ireland",
        service: "s3-eu-west-1",
        status: "3",
        summary: "S3 down",
      },
    ]);
    const ec2 = StatusParsers.aws(events, {
      ...service,
      regions: ["eu-west-1"],
      services: ["ec2"],
    });
    expect(ec2.level).toBe("degraded");
    expect(ec2.incidents).toHaveLength(1);
  });
});

describe("http", () => {
  test("2xx and 3xx are up by default; anything else is an outage", () => {
    expect(StatusParsers.http(200).level).toBe("ok");
    expect(StatusParsers.http(302).level).toBe("ok");
    expect(StatusParsers.http(502).level).toBe("outage");
  });

  test("expect replaces the default", () => {
    expect(StatusParsers.http(401, [200, 401]).level).toBe("ok");
    expect(StatusParsers.http(302, [200]).level).toBe("outage");
  });
});

describe("worst", () => {
  test("outage beats degraded beats unknown beats maintenance beats ok", () => {
    expect(StatusParsers.worst([])).toBe("ok");
    expect(StatusParsers.worst(["ok", "maintenance"])).toBe("maintenance");
    expect(StatusParsers.worst(["maintenance", "unknown"])).toBe("unknown");
    expect(StatusParsers.worst(["unknown", "degraded"])).toBe("degraded");
    expect(StatusParsers.worst(["degraded", "outage", "ok"])).toBe("outage");
  });
});
