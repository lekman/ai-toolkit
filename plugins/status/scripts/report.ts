/** Formats results for a person, and picks the exit code. */

import type { Connection, Level, ServiceResult } from "./types.ts";

import { StatusParsers } from "./parsers.ts";

const WORD: Record<Level, string> = {
  degraded: "degraded",
  maintenance: "maintenance",
  ok: "ok",
  outage: "OUTAGE",
  unknown: "unknown",
};

/** Report formatting. */
export class StatusReport {
  /**
   * The exit code: 0 when nothing is affected, 1 when a service is degraded
   * or in an outage, 3 when nothing is affected but a feed couldn't be read,
   * 4 when this machine is offline.
   * @param results - The check's results.
   * @param offline - True when nothing, not even a connectivity page, answered.
   * @returns The exit code.
   */
  static exitCode(results: ServiceResult[], offline = false): number {
    if (offline) return 4;
    const worst = StatusParsers.worst(results.map((r) => r.level));
    if (worst === "outage" || worst === "degraded") return 1;
    return worst === "unknown" ? 3 : 0;
  }

  /**
   * A plain-text report: one line per service, then the details of each
   * service that is not ok.
   * @param results - The check's results.
   * @param checkedAt - When the check ran.
   * @param offline - Set when nothing answered: the connections to list.
   * @param offline.connections - Your own connections from the services file.
   * @returns The report.
   */
  static text(
    results: ServiceResult[],
    checkedAt: Date,
    offline?: { connections: Connection[] },
  ): string {
    const heading = `Service status at ${checkedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    if (offline)
      return [
        heading,
        "",
        ...StatusReport.offline(results.length, offline.connections),
      ].join("\n");
    const width = Math.max(...results.map((r) => r.name.length), 7);
    const lines = results.map(
      (r) =>
        `${r.name.padEnd(width)}  ${WORD[r.level].padEnd(11)}  ${StatusReport.clip(r.summary, 110)}`,
    );
    const affected = results.filter((r) => r.level !== "ok");
    const details = affected.flatMap((r) => [
      "",
      `${r.name} (${WORD[r.level]}): ${r.source}`,
      ...(r.error ? [`  ! ${r.error}`] : []),
      ...r.incidents.map(
        (i) =>
          `  - ${StatusReport.clip(i.title, 140)}${i.status ? ` [${i.status}]` : ""}${i.updated ? `, updated ${i.updated}` : ""}${i.url && i.url !== r.source ? `\n    ${i.url}` : ""}`,
      ),
    ]);
    const counts = (["outage", "degraded", "maintenance", "unknown"] as Level[])
      .map((l) => [l, results.filter((r) => r.level === l).length] as const)
      .filter(([, n]) => n > 0)
      .map(([l, n]) => `${n} ${WORD[l]}`);
    const footer =
      counts.length === 0
        ? `All ${results.length} services ok`
        : `${counts.join(", ")} of ${results.length} services`;
    return [heading, "", ...lines, ...details, "", footer].join("\n");
  }

  private static offline(count: number, connections: Connection[]): string[] {
    const lines = [
      "OFFLINE: this machine got no answer from any of the",
      `${count} services, nor from Apple's or Google's connectivity pages.`,
      "The fault is most likely your own connection, not the services.",
    ];
    if (connections.length === 0) return lines;
    return [
      ...lines,
      "",
      "Your connections have no public status feed. Check them from another",
      "network, such as a phone on mobile data:",
      ...connections.map((c) => {
        const where = [c.page, c.phone].filter(Boolean).join(", ");
        return `  - ${c.name}${c.role ? ` (${c.role})` : ""}${where ? `: ${where}` : ""}`;
      }),
    ];
  }

  private static clip(text: string, length: number): string {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }
}
