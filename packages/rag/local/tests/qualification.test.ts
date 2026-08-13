import { describe, expect, test } from "bun:test";

import type { IqProbes } from "../src/qualification";

import { Iq, Oq, Report } from "../src/qualification";

const healthyProbes: IqProbes = {
  claudeMcpRegistered: true,
  configProblems: [],
  launchdLoaded: { scan: true, watch: true },
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
