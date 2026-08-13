import { describe, expect, test } from "bun:test";

import type {
  PlannerSettings,
  SharedObsidianConfig,
} from "../src/config/types.ts";

import { Config } from "../src/config/config.ts";

const SHARED: SharedObsidianConfig = {
  clients: {
    "/Users/me/Repo/lekman": "Lekman Consulting",
    "/Users/me/Repo/lekman/client-work": "Globex",
  },
  dashboard: "Dashboard.md",
  vault: "/Users/me/Vault",
};

const DEFAULTS: PlannerSettings = {
  clients: [],
  dashboardPath: "",
  showClientHeadings: "auto",
};

const SHARED_PATH = "/Users/me/.claude/obsidian.json";

describe("clientForPath", () => {
  test("takes the longest matching prefix", () => {
    expect(
      Config.clientForPath(
        SHARED.clients,
        "/Users/me/Repo/lekman/client-work/x",
      ),
    ).toBe("Globex");
  });

  test("matches the prefix itself", () => {
    expect(Config.clientForPath(SHARED.clients, "/Users/me/Repo/lekman")).toBe(
      "Lekman Consulting",
    );
  });

  test("does not match a sibling with a shared name prefix", () => {
    expect(
      Config.clientForPath(SHARED.clients, "/Users/me/Repo/lekman-other"),
    ).toBeNull();
  });

  test("returns null with no map or no path", () => {
    expect(Config.clientForPath(undefined, "/x")).toBeNull();
    expect(Config.clientForPath(SHARED.clients, undefined)).toBeNull();
  });
});

describe("resolve", () => {
  test("derives dashboard and client from the shared config", () => {
    const config = Config.resolve(
      DEFAULTS,
      SHARED,
      "/Users/me/Repo/lekman/ai-toolkit",
      SHARED_PATH,
    );
    expect(config.dashboardPath).toBe("/Users/me/Vault/Dashboard.md");
    expect(config.clients).toEqual(["Lekman Consulting"]);
    expect(config.problem).toBeNull();
  });

  test("settings override the shared config", () => {
    const config = Config.resolve(
      { ...DEFAULTS, clients: ["Evinova"], dashboardPath: "/tmp/D.md" },
      SHARED,
      "/Users/me/Repo/lekman/ai-toolkit",
      SHARED_PATH,
    );
    expect(config.dashboardPath).toBe("/tmp/D.md");
    expect(config.clients).toEqual(["Evinova"]);
  });

  test("shows every client when nothing resolves the workspace", () => {
    const config = Config.resolve(
      DEFAULTS,
      SHARED,
      "/somewhere/else",
      SHARED_PATH,
    );
    expect(config.clients).toEqual([]);
    expect(config.dashboardPath).toBe("/Users/me/Vault/Dashboard.md");
  });

  test("reports an unreadable shared config", () => {
    const config = Config.resolve(DEFAULTS, null, "/x", SHARED_PATH);
    expect(config.dashboardPath).toBeNull();
    expect(config.problem).toContain("Could not read");
  });

  test("reports a shared config with no vault", () => {
    const config = Config.resolve(DEFAULTS, {}, "/x", SHARED_PATH);
    expect(config.dashboardPath).toBeNull();
    expect(config.problem).toContain('no "vault"');
  });

  test("ignores blank entries in the client list", () => {
    const config = Config.resolve(
      { ...DEFAULTS, clients: ["  ", ""] },
      SHARED,
      "/Users/me/Repo/lekman",
      SHARED_PATH,
    );
    expect(config.clients).toEqual(["Lekman Consulting"]);
  });
});
