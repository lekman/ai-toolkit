import { describe, expect, test } from "bun:test";

import type { IqProbes } from "../src/qualification";

import { Iq, Oq, Report } from "../src/qualification";

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
    // machine whose watcher could not read the vault at all.
    const results = Iq.evaluate({
      ...healthyProbes,
      launchdExit: { scan: 1, server: 0, watch: 1 },
    });
    const agents = results.find((check) =>
      check.name.startsWith("launchd agents"),
    );
    expect(agents?.pass).toBe(false);
    expect(agents?.detail).toContain("exit=1");
    expect(agents?.remediation).toContain("Full Disk Access");
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
