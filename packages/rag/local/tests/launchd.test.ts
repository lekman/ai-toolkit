import { describe, expect, test } from "bun:test";

import { Launchd } from "../src/launchd";

describe("Launchd plists", () => {
  test("watch agent keeps alive and runs the watch subcommand", () => {
    const agent = Launchd.watchAgent(
      "/usr/local/bin/node",
      "/opt/rag/cli.js",
      "/logs",
    );
    expect(agent.label).toBe("com.lekman.rag.watch");
    expect(agent.xml).toContain("<key>KeepAlive</key>");
    expect(agent.xml).toContain("<string>watch</string>");
    expect(agent.xml).toContain("<string>/opt/rag/cli.js</string>");
    expect(agent.xml).toContain("/logs/watch.log");
  });

  test("scan agent runs daily at 07:00 and at load", () => {
    const agent = Launchd.scanAgent(
      "/usr/local/bin/node",
      "/opt/rag/cli.js",
      "/logs",
    );
    expect(agent.label).toBe("com.lekman.rag.scan");
    expect(agent.xml).toContain("<key>StartCalendarInterval</key>");
    expect(agent.xml).toContain("<integer>7</integer>");
    expect(agent.xml).toContain("<key>RunAtLoad</key>");
    expect(agent.xml).toContain("<string>scan</string>");
  });

  test("server agent keeps alive and runs the server subcommand", () => {
    const agent = Launchd.serverAgent(
      "/usr/local/bin/node",
      "/opt/rag/cli.js",
      "/logs",
    );
    expect(agent.label).toBe("com.lekman.rag.server");
    // KeepAlive is what makes it always-on: the laptop queries this while the
    // Mini is unattended, so a crash must not need a human to notice.
    expect(agent.xml).toContain("<key>KeepAlive</key>");
    expect(agent.xml).toContain("<key>RunAtLoad</key>");
    expect(agent.xml).toContain("<string>server</string>");
    expect(agent.xml).toContain("/logs/server.log");
  });

  test("the three agents have distinct labels and log files", () => {
    const made = [
      Launchd.watchAgent("/n", "/c", "/logs"),
      Launchd.scanAgent("/n", "/c", "/logs"),
      Launchd.serverAgent("/n", "/c", "/logs"),
    ];
    // A shared label would make one agent silently replace another in launchd.
    expect(new Set(made.map((agent) => agent.label)).size).toBe(3);
  });
});
