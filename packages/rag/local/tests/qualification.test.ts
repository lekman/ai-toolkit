import { describe, expect, test } from "bun:test";

import type { IqProbes } from "../src/qualification";

import { decodeWaitStatus, Iq, Oq, Report } from "../src/qualification";

const healthyProbes: IqProbes = {
  claudeMcpRegistered: true,
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

  test("each failing probe fails its check with a remediation", () => {
    const results = Iq.evaluate({
      ...healthyProbes,
      claudeMcpRegistered: false,
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
