/** Reads each provider's status feed into a level, a summary and open incidents. Pure: no I/O. */

import type {
  AwsService,
  GoogleWorkspaceService,
  Incident,
  Level,
  MicrosoftService,
  StatuspageService,
} from "./types.ts";

/** The level, summary and incidents a feed gives, before the service's name is added. */
export interface Reading {
  error?: string;
  incidents: Incident[];
  level: Level;
  summary: string;
}

const RANK: Record<Level, number> = {
  degraded: 3,
  maintenance: 1,
  ok: 0,
  outage: 4,
  unknown: 2,
};

const STATUSPAGE_INDICATOR: Record<string, Level> = {
  critical: "outage",
  maintenance: "maintenance",
  major: "outage",
  minor: "degraded",
  none: "ok",
};

const STATUSPAGE_COMPONENT: Record<string, Level> = {
  degraded_performance: "degraded",
  major_outage: "outage",
  operational: "ok",
  partial_outage: "degraded",
  under_maintenance: "maintenance",
};

const GOOGLE_IMPACT: Record<string, Level> = {
  SERVICE_DISRUPTION: "degraded",
  SERVICE_INFORMATION: "degraded",
  SERVICE_OUTAGE: "outage",
};

interface StatuspageSummary {
  components?: { group?: boolean; name: string; status: string }[];
  incidents?: {
    components?: { name: string }[];
    name: string;
    shortlink?: string;
    status: string;
    updated_at?: string;
  }[];
  page?: { url?: string };
  scheduled_maintenances?: { name: string; status: string }[];
  status?: { description?: string; indicator?: string };
}

interface MicrosoftPost {
  LastUpdatedTime?: string;
  Message?: null | string;
  ServiceDisplayName?: string;
  Status?: string;
  Title?: null | string;
}

interface GoogleIncident {
  affected_products?: { title: string }[];
  begin?: string;
  end?: null | string;
  external_desc?: string;
  modified?: string;
  service_name?: string;
  status_impact?: string;
  uri?: string;
}

interface AwsEvent {
  date?: string;
  region_name?: string;
  service?: string;
  service_name?: string;
  status?: number | string;
  summary?: string;
}

/** Feed parsers, one per provider kind. */
export class StatusParsers {
  /**
   * The AWS Health Dashboard's current events. The body is UTF-16 with a byte
   * order mark (big-endian when fetched on 13 Nov 2026). The feed does not
   * document its status codes: an ongoing regional availability event carried
   * "3" on 13 Nov 2026, so 3 reads as an outage and 1 or 2 as degraded.
   * @param body - The raw response bytes.
   * @param service - Which regions and service codes count.
   * @returns The reading.
   */
  static aws(body: Uint8Array, service: AwsService): Reading {
    const events = StatusParsers.json(StatusParsers.decode(body)) as AwsEvent[];
    const regions = (service.regions ?? []).map((r) => r.toLowerCase());
    const codes = (service.services ?? []).map((s) => s.toLowerCase());
    const matching = events.filter((e) => {
      const id = (e.service ?? "").toLowerCase();
      const inRegion =
        regions.length === 0 || regions.some((r) => id.endsWith(`-${r}`));
      const forService =
        codes.length === 0 || codes.some((c) => id.startsWith(`${c}-`));
      return inRegion && forService;
    });
    const levelOf = (status: AwsEvent["status"]): Level => {
      const code = Number(status);
      if (code === 0) return "ok";
      return code >= 3 ? "outage" : "degraded";
    };
    const incidents = matching.map((e) => ({
      status: `status ${e.status}`,
      title: `${e.summary ?? "Event"} (${e.region_name ?? e.service ?? "AWS"})`,
      updated: e.date
        ? new Date(Number(e.date) * 1000).toISOString()
        : undefined,
      url: "https://health.aws.amazon.com/health/status",
    }));
    const level = StatusParsers.worst(matching.map((e) => levelOf(e.status)));
    return {
      incidents,
      level,
      summary:
        incidents.length === 0
          ? "No current events"
          : `${incidents.length} current event${incidents.length === 1 ? "" : "s"}`,
    };
  }

  /**
   * Decodes a body, honouring a UTF-16 or UTF-8 byte order mark.
   * @param body - The raw bytes.
   * @returns The text.
   */
  static decode(body: Uint8Array): string {
    if (body[0] === 0xfe && body[1] === 0xff)
      return new TextDecoder("utf-16be").decode(body.subarray(2));
    if (body[0] === 0xff && body[1] === 0xfe)
      return new TextDecoder("utf-16le").decode(body.subarray(2));
    return new TextDecoder("utf-8").decode(body);
  }

  /**
   * The Google Workspace dashboard's incident list. An incident with no end, or
   * an end still ahead, is open.
   * @param body - The raw response bytes.
   * @param service - Which products count.
   * @param now - The time to judge "open" against.
   * @returns The reading.
   */
  static googleWorkspace(
    body: Uint8Array,
    service: GoogleWorkspaceService,
    now: Date,
  ): Reading {
    const all = StatusParsers.json(
      StatusParsers.decode(body),
    ) as GoogleIncident[];
    const products = (service.products ?? []).map((p) => p.toLowerCase());
    const open = all.filter((i) => {
      const ended = i.end ? new Date(i.end) <= now : false;
      if (ended) return false;
      if (products.length === 0) return true;
      const names = [
        i.service_name ?? "",
        ...(i.affected_products ?? []).map((p) => p.title),
      ].map((n) => n.toLowerCase());
      return names.some((n) => products.includes(n));
    });
    const incidents = open.map((i) => ({
      status: i.status_impact,
      title: `${i.service_name ?? "Google Workspace"}: ${StatusParsers.googleSummary(i.external_desc)}`,
      updated: i.modified ?? i.begin,
      url: i.uri
        ? `https://www.google.com/appsstatus/dashboard/${i.uri}`
        : "https://www.google.com/appsstatus/dashboard/",
    }));
    const level = StatusParsers.worst(
      open.map((i) => GOOGLE_IMPACT[i.status_impact ?? ""] ?? "degraded"),
    );
    return {
      incidents,
      level,
      summary:
        incidents.length === 0
          ? "No open incidents"
          : (incidents[0]?.title ?? ""),
    };
  }

  /**
   * An HTTP probe's answer.
   * @param status - The response's status code.
   * @param expect - The codes that mean up; empty means 200 to 399.
   * @returns The reading.
   */
  static http(status: number, expect: number[] = []): Reading {
    const up =
      expect.length > 0
        ? expect.includes(status)
        : status >= 200 && status < 400;
    return {
      incidents: up ? [] : [{ title: `HTTP ${status}` }],
      level: up ? "ok" : "outage",
      summary: `HTTP ${status}`,
    };
  }

  /**
   * A feed on status.cloud.microsoft. It is either one post or a list of
   * posts, one per service.
   * @param body - The raw response bytes.
   * @param service - Which service names count, for a list.
   * @returns The reading.
   */
  static microsoft(body: Uint8Array, service: MicrosoftService): Reading {
    const parsed = StatusParsers.json(StatusParsers.decode(body)) as
      MicrosoftPost | MicrosoftPost[];
    const posts = Array.isArray(parsed) ? parsed : [parsed];
    const wanted = (service.components ?? []).map((c) => c.toLowerCase());
    const chosen =
      wanted.length === 0
        ? posts
        : posts.filter((p) =>
            wanted.includes((p.ServiceDisplayName ?? "").toLowerCase()),
          );
    const missing = (service.components ?? []).filter(
      (c) =>
        !posts.some(
          (p) => (p.ServiceDisplayName ?? "").toLowerCase() === c.toLowerCase(),
        ),
    );
    const levels = chosen.map((p) => StatusParsers.microsoftLevel(p.Status));
    const incidents = chosen
      .filter((p) => StatusParsers.microsoftLevel(p.Status) !== "ok")
      .map((p) => ({
        status: p.Status,
        title: p.Title || p.ServiceDisplayName || StatusParsers.text(p.Message),
        updated: p.LastUpdatedTime,
        url: "https://status.cloud.microsoft/",
      }));
    const detail = chosen
      .map((p) => StatusParsers.currentStatus(p.Message))
      .find((d) => d.length > 0 && levels.some((l) => l !== "ok"));
    if (chosen.length === 0)
      return {
        error: `not in the feed: ${missing.join(", ")}`,
        incidents: [],
        level: "unknown",
        summary: "No matching service in the feed",
      };
    const level = StatusParsers.worst(levels);
    return {
      error:
        missing.length > 0
          ? `not in the feed: ${missing.join(", ")}`
          : undefined,
      incidents,
      level,
      summary:
        level === "ok"
          ? (chosen[0]?.Status ?? "Operational")
          : (incidents[0]?.title ?? "") + (detail ? ` | ${detail}` : ""),
    };
  }

  /**
   * An Atlassian Statuspage summary. With components named, only those decide
   * the level; otherwise the page's overall indicator does.
   * @param body - The raw response bytes.
   * @param service - The page and its components.
   * @returns The reading.
   */
  static statuspage(body: Uint8Array, service: StatuspageService): Reading {
    const page = StatusParsers.json(
      StatusParsers.decode(body),
    ) as StatuspageSummary;
    const wanted = (service.components ?? []).map((c) => c.toLowerCase());
    const components = (page.components ?? []).filter((c) => !c.group);
    const open = (page.incidents ?? []).filter(
      (i) => i.status !== "resolved" && i.status !== "postmortem",
    );
    const base = service.url.replace(/\/+$/, "");
    const toIncident = (i: (typeof open)[number]): Incident => ({
      status: i.status,
      title: i.name,
      updated: i.updated_at,
      url: i.shortlink ?? base,
    });
    if (wanted.length === 0) {
      const level =
        STATUSPAGE_INDICATOR[page.status?.indicator ?? ""] ?? "unknown";
      const incidents = open.map(toIncident);
      return {
        incidents,
        level,
        summary:
          level === "ok"
            ? (page.status?.description ?? "All Systems Operational")
            : (incidents[0]?.title ?? page.status?.description ?? ""),
      };
    }
    const chosen = components.filter((c) =>
      wanted.includes(c.name.toLowerCase()),
    );
    const missing = (service.components ?? []).filter(
      (w) => !components.some((c) => c.name.toLowerCase() === w.toLowerCase()),
    );
    if (chosen.length === 0)
      return {
        error: `not on the page: ${missing.join(", ")}`,
        incidents: [],
        level: "unknown",
        summary: "No matching component on the page",
      };
    const names = new Set(chosen.map((c) => c.name.toLowerCase()));
    const incidents = open
      .filter(
        (i) =>
          !i.components ||
          i.components.length === 0 ||
          i.components.some((c) => names.has(c.name.toLowerCase())),
      )
      .map(toIncident);
    const level = StatusParsers.worst(
      chosen.map((c) => STATUSPAGE_COMPONENT[c.status] ?? "unknown"),
    );
    const affected = chosen.filter((c) => c.status !== "operational");
    return {
      error:
        missing.length > 0
          ? `not on the page: ${missing.join(", ")}`
          : undefined,
      incidents,
      level,
      summary:
        level === "ok"
          ? "Operational"
          : (incidents[0]?.title ??
            affected
              .map((c) => `${c.name}: ${c.status.replace(/_/g, " ")}`)
              .join(", ")),
    };
  }

  /**
   * The worst of several levels; ok when there are none.
   * @param levels - The levels to combine.
   * @returns The worst level.
   */
  static worst(levels: Level[]): Level {
    return levels.reduce<Level>(
      (worst, l) => (RANK[l] > RANK[worst] ? l : worst),
      "ok",
    );
  }

  private static currentStatus(message: null | string | undefined): string {
    const text = StatusParsers.text(message);
    const match =
      /Current status:\s*(.+?)(?:\s{2,}|Scope of impact:|Next update by:|$)/s.exec(
        text,
      );
    return StatusParsers.clip(match?.[1] ?? "", 240);
  }

  private static clip(text: string, length: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
  }

  private static googleSummary(desc: string | undefined): string {
    const text = desc ?? "";
    const match = /\*\*Summary:\*\*\s*\n?(.+)/.exec(text);
    return StatusParsers.clip(match?.[1] ?? text.split("\n")[0] ?? "", 160);
  }

  private static json(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("the feed did not return JSON");
    }
  }

  private static microsoftLevel(status: string | undefined): Level {
    const s = (status ?? "").toLowerCase();
    if (
      ["available", "operational", "resolved", "service restored"].includes(s)
    )
      return "ok";
    if (s.includes("interruption") || s.includes("outage")) return "outage";
    return s ? "degraded" : "unknown";
  }

  private static text(html: null | string | undefined): string {
    // The result is printed to a terminal, never rendered as HTML. Angle
    // brackets left after the tags are removed are dropped too, so a nested
    // tag such as "<scr<b>ipt>" cannot survive as "<script>".
    return (html ?? "")
      .replace(/<br\s*\/?>/gi, "  ")
      .replace(/<\/div>/gi, "  ")
      .replace(/<[^>]+>/g, "")
      .replace(/[<>]/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }
}
