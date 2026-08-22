import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IqProbes } from "../src/qualification";

import {
  decodeWaitStatus,
  Iq,
  Oq,
  QualificationRunner,
  Report,
} from "../src/qualification";

const healthyProbes: IqProbes = {
  claudeMcp: "connected",
  configProblems: [],
  launchdExit: { scan: 0, server: 0, watch: 0 },
  launchdLoaded: { scan: true, server: true, watch: true },
  nodeMajor: 22,
  storageWritable: true,
  vaultReadable: true,
  voyageKeyPresent: true,
  voyageStatus: 200,
};

describe("Iq.evaluate", () => {
  test("all probes healthy → all checks pass", () => {
    const results = Iq.evaluate(healthyProbes);
    expect(results).toHaveLength(8);
    expect(Report.allPass(results)).toBe(true);
  });

  test("an agent that is loaded but crash-looping fails the check", () => {
    // The EPERM case seen on the Mini: launchd reports the agent loaded while
    // it dies on every start. Reporting only "loaded" produced an IQ PASS on a
    // machine whose watcher could not read the vault at all. LastExitStatus is
    // a raw wait status, so exit code 1 arrives as 256.
    const results = Iq.evaluate({
      ...healthyProbes,
      launchdExit: { scan: 256, server: 0, watch: 256 },
    });
    const agents = results.find((check) =>
      check.name.startsWith("launchd agents"),
    );
    expect(agents?.pass).toBe(false);
    expect(agents?.detail).toContain("exit code 1");
    expect(agents?.remediation).toContain("Full Disk Access");
  });

  test("a signal death does not fail the check, and the detail says so", () => {
    // A deliberate `launchctl kickstart -k` restart SIGTERMs the agent, and
    // launchd records the signal number (15) as LastExitStatus. That is a
    // restart, not a crash — failing on it made every restart flip IQ to FAIL.
    const results = Iq.evaluate({
      ...healthyProbes,
      launchdExit: { scan: 0, server: 0, watch: 15 },
    });
    const agents = results.find((check) =>
      check.name.startsWith("launchd agents"),
    );
    expect(agents?.pass).toBe(true);
    expect(agents?.detail).toContain("SIGTERM");
    expect(agents?.detail).not.toContain("exit");
  });

  test("an unknown last exit status behaves like a clean one", () => {
    const results = Iq.evaluate({
      ...healthyProbes,
      launchdExit: { scan: null, server: null, watch: null },
    });
    const agents = results.find((check) =>
      check.name.startsWith("launchd agents"),
    );
    expect(agents?.pass).toBe(true);
    expect(agents?.detail).toBe("scan: loaded, watch: loaded, server: loaded");
  });

  test.each([
    // state, passes?, what the operator must be able to tell them apart by
    ["connected", true, "registered and connected"],
    ["configured", true, "not runnable here"],
    ["unknown", true, "could not verify"],
    ["absent", false, "not registered"],
  ] as const)(
    "MCP state %s -> pass=%s, and says why",
    (claudeMcp, passes, phrase) => {
      const check = Iq.evaluate({ ...healthyProbes, claudeMcp }).find(
        (result) => result.name === "MCP registration",
      );
      expect(check?.pass).toBe(passes);
      expect(check?.detail).toContain(phrase);
    },
  );

  test("an unverifiable probe never reads as a failure", () => {
    // The regression this guards: `claude` is not on PATH over non-interactive
    // SSH, the exec failed, and IQ reported the server unregistered on a
    // machine where it was registered and connected. A false FAIL teaches the
    // operator to ignore FAILs, which is worse than having no check.
    const unknown = Iq.evaluate({ ...healthyProbes, claudeMcp: "unknown" });
    const absent = Iq.evaluate({ ...healthyProbes, claudeMcp: "absent" });
    expect(Report.allPass(unknown)).toBe(true);
    expect(Report.allPass(absent)).toBe(false);
    // ...but it must not pass *quietly* — the evidence has to say so.
    expect(
      unknown.find((r) => r.name === "MCP registration")?.detail,
    ).not.toContain("registered and connected");
  });

  test("each failing probe fails its check with a remediation", () => {
    const results = Iq.evaluate({
      ...healthyProbes,
      claudeMcp: "absent",
      voyageKeyPresent: false,
      voyageStatus: null,
    });
    const failing = results.filter((result) => !result.pass);
    expect(failing.map((result) => result.name)).toEqual([
      "embedding credential",
      "embedding endpoint reachable",
      "MCP registration",
    ]);
    expect(failing.every((result) => result.remediation.length > 0)).toBe(true);
  });
});

describe("decodeWaitStatus", () => {
  test("decodes launchd's raw wait status", () => {
    expect(decodeWaitStatus(null)).toEqual({ kind: "unknown" });
    expect(decodeWaitStatus(0)).toEqual({ kind: "clean" });
    // exit codes live in the high byte
    expect(decodeWaitStatus(256)).toEqual({ code: 1, kind: "exit" });
    expect(decodeWaitStatus(512)).toEqual({ code: 2, kind: "exit" });
    // signals live in the low seven bits
    expect(decodeWaitStatus(15)).toEqual({
      kind: "signal",
      name: "SIGTERM",
      signal: 15,
    });
    expect(decodeWaitStatus(9)).toEqual({
      kind: "signal",
      name: "SIGKILL",
      signal: 9,
    });
    // 0x80 is the core-dump flag on top of the signal number
    expect(decodeWaitStatus(0x8b)).toEqual({
      kind: "signal",
      name: "SIGSEGV",
      signal: 11,
    });
  });
});

describe("Oq.fixture", () => {
  test("fixture lands in the OQ folder and carries the sentinel", () => {
    const fixture = Oq.fixture("abc-123");
    expect(fixture.relPath).toBe("_OQ/oq-abc-123.md");
    expect(fixture.content).toContain("abc-123");
  });
});

describe("Report.render", () => {
  test("renders pass and fail rows with remediation on failures only", () => {
    const markdown = Report.render(
      "IQ — test",
      [
        { detail: "ok", name: "good", pass: true, remediation: "" },
        { detail: "broken", name: "bad", pass: false, remediation: "fix it" },
      ],
      "2026-08-09T12:00:00Z",
    );
    expect(markdown).toContain("**FAIL** (1/2 checks)");
    expect(markdown).toContain("| ✅ | good | ok |");
    expect(markdown).toContain("| ❌ | bad | broken — remediation: fix it |");
  });
});

describe("QualificationRunner.probeClaudeMcp", () => {
  const configWith = (body: string): string => {
    const path = join(tmpdir(), `claude-${randomUUID()}.json`);
    writeFileSync(path, body);
    return path;
  };

  test("runs the CLI when one of the candidates resolves", async () => {
    // `true` exits 0 for any arguments, standing in for a working `claude`.
    const state = await QualificationRunner.probeClaudeMcp(
      ["/nonexistent/claude", "/usr/bin/true"],
      "/nonexistent/config.json",
    );
    expect(state).toBe("connected");
  });

  test("a CLI that runs and rejects is a real negative, not a missing binary", async () => {
    // `false` exits 1: the CLI answered, and the answer was no.
    const state = await QualificationRunner.probeClaudeMcp(
      ["/usr/bin/false"],
      configWith('{"mcpServers":{"rag":{}}}'),
    );
    expect(state).toBe("absent");
  });

  test("no runnable CLI falls back to the config and reports configured", async () => {
    const state = await QualificationRunner.probeClaudeMcp(
      ["/nonexistent/claude"],
      configWith('{"mcpServers":{"rag":{"type":"stdio"}}}'),
    );
    expect(state).toBe("configured");
  });

  test("no runnable CLI and no rag entry is absent", async () => {
    const state = await QualificationRunner.probeClaudeMcp(
      ["/nonexistent/claude"],
      configWith('{"mcpServers":{"other":{}}}'),
    );
    expect(state).toBe("absent");
  });

  test.each([
    ["an unreadable config", "/nonexistent/config.json"],
    ["a config with no mcpServers key", null],
  ])("%s is unknown, never a failure", async (_label, path) => {
    const state = await QualificationRunner.probeClaudeMcp(
      ["/nonexistent/claude"],
      path ?? configWith("{}"),
    );
    expect(state).toBe("unknown");
  });
});
