/** Validates the services file. Pure: the caller reads the file. */

import type { Connection, Service, StatusConfig } from "./types.ts";

const KINDS = new Set([
  "aws",
  "google-workspace",
  "http",
  "microsoft",
  "statuspage",
]);

/** Configuration parsing and filtering. */
export class StatusConfigReader {
  /**
   * The services whose names contain any of the given words, case-insensitive.
   * @param config - The parsed configuration.
   * @param only - Words to match; empty keeps every service.
   * @returns The chosen services, in configuration order.
   */
  static filter(config: StatusConfig, only: string[]): Service[] {
    const words = only.map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.length === 0) return config.services;
    return config.services.filter((s) =>
      words.some((w) => s.name.toLowerCase().includes(w)),
    );
  }

  /**
   * Parses and checks the services file.
   * @param text - The file's contents.
   * @returns The configuration.
   * @throws {Error} When the file is not valid, naming the first problem.
   */
  static parse(text: string): StatusConfig {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("the services file is not JSON");
    }
    const services = (raw as { services?: unknown })?.services;
    if (!Array.isArray(services) || services.length === 0)
      throw new Error('the services file needs a non-empty "services" list');
    const names = new Set<string>();
    services.forEach((s: unknown, index) => {
      const where = `services[${index}]`;
      const entry = s as Record<string, unknown>;
      if (typeof entry?.name !== "string" || !entry.name.trim())
        throw new Error(`${where} needs a name`);
      if (names.has(entry.name.toLowerCase()))
        throw new Error(`${where}: the name "${entry.name}" is used twice`);
      names.add(entry.name.toLowerCase());
      if (typeof entry.kind !== "string" || !KINDS.has(entry.kind))
        throw new Error(
          `${where} (${entry.name}): kind must be one of ${[...KINDS].join(", ")}`,
        );
      const needsUrl = entry.kind === "statuspage" || entry.kind === "http";
      if (needsUrl && !StatusConfigReader.isUrl(entry.url))
        throw new Error(`${where} (${entry.name}) needs an http(s) url`);
      if (
        entry.kind === "microsoft" &&
        !/^[A-Za-z0-9]+$/.test(String(entry.feed ?? ""))
      )
        throw new Error(
          `${where} (${entry.name}) needs a feed, such as mac, m365Consumer or azure`,
        );
      for (const list of [
        "components",
        "products",
        "regions",
        "services",
        "expect",
      ])
        if (entry[list] !== undefined && !Array.isArray(entry[list]))
          throw new Error(`${where} (${entry.name}): ${list} must be a list`);
    });
    const connections = (raw as { connections?: unknown }).connections;
    if (connections !== undefined) {
      if (!Array.isArray(connections))
        throw new Error('"connections" must be a list');
      connections.forEach((c: unknown, index) => {
        const entry = c as Record<string, unknown>;
        if (typeof entry?.name !== "string" || !entry.name.trim())
          throw new Error(`connections[${index}] needs a name`);
        if (entry.page !== undefined && !StatusConfigReader.isUrl(entry.page))
          throw new Error(
            `connections[${index}] (${entry.name}): page must be an http(s) url`,
          );
      });
    }
    return {
      connections: connections as Connection[] | undefined,
      services: services as Service[],
    };
  }

  private static isUrl(value: unknown): boolean {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }
}
