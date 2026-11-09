import { describe, expect, test } from "bun:test";

import {
  type Alert,
  alertEvent,
  alertKey,
  alertUrl,
  closedEvent,
  diffAlerts,
  parseAlert,
  parseRepos,
  pickChecks,
} from "../src/alerts";
import {
  owners,
  rawCodeScanning,
  rawDependabot,
  rawSecretScanning,
} from "./fixtures";

const alert = (overrides: Partial<Alert> = {}): Alert => ({
  alertType: "dependabot",
  number: 4,
  package: "left-pad",
  repo: "acme/api",
  severity: "critical",
  state: "OPEN",
  ...overrides,
});

describe("parseAlert", () => {
  test("Dependabot: number, package and the vulnerability's severity only", () => {
    const parsed = parseAlert(rawDependabot(), "dependabot", "acme/api");
    expect(parsed).toEqual(alert());
    const text = JSON.stringify(parsed);
    expect(text).not.toContain("instructions");
    expect(text).not.toContain("token");
    expect(text).not.toContain("evil");
  });

  test("Dependabot: falls back to the advisory's severity", () => {
    expect(
      parseAlert(
        rawDependabot({ security_vulnerability: null }),
        "dependabot",
        "acme/api",
      )?.severity,
    ).toBe("high");
  });

  test("Dependabot: a package name out of shape is dropped, the alert kept", () => {
    expect(
      parseAlert(
        rawDependabot({
          dependency: { package: { name: "run this; rm -rf /" } },
        }),
        "dependabot",
        "acme/api",
      )?.package,
    ).toBeNull();
  });

  test("code scanning: security severity only, no rule text", () => {
    const parsed = parseAlert(rawCodeScanning(), "code_scanning", "acme/api");
    expect(parsed).toEqual({
      alertType: "code_scanning",
      number: 30,
      package: null,
      repo: "acme/api",
      severity: "medium",
      state: "OPEN",
    });
    expect(
      parseAlert(
        rawCodeScanning({ rule: { security_severity_level: null } }),
        "code_scanning",
        "acme/api",
      )?.severity,
    ).toBeNull();
  });

  test("secret scanning: never keeps the secret or its type", () => {
    const parsed = parseAlert(
      rawSecretScanning(),
      "secret_scanning",
      "acme/api",
    );
    expect(parsed).toEqual({
      alertType: "secret_scanning",
      number: 2,
      package: null,
      repo: "acme/api",
      severity: null,
      state: "OPEN",
    });
    expect(JSON.stringify(parsed)).not.toContain("must-never");
  });

  test("maps closed states to FIXED or DISMISSED", () => {
    const state = (raw: Record<string, unknown>, type: Alert["alertType"]) =>
      parseAlert(raw, type, "acme/api")?.state;
    expect(state(rawDependabot({ state: "fixed" }), "dependabot")).toBe(
      "FIXED",
    );
    expect(
      state(rawDependabot({ state: "auto_dismissed" }), "dependabot"),
    ).toBe("DISMISSED");
    expect(
      state(rawCodeScanning({ state: "dismissed" }), "code_scanning"),
    ).toBe("DISMISSED");
    expect(
      state(
        rawSecretScanning({ resolution: "revoked", state: "resolved" }),
        "secret_scanning",
      ),
    ).toBe("FIXED");
    expect(
      state(
        rawSecretScanning({ resolution: "false_positive", state: "resolved" }),
        "secret_scanning",
      ),
    ).toBe("DISMISSED");
  });

  test("rejects an alert out of shape", () => {
    expect(parseAlert(null, "dependabot", "acme/api")).toBeNull();
    expect(
      parseAlert(rawDependabot({ number: "4" }), "dependabot", "acme/api"),
    ).toBeNull();
    expect(
      parseAlert(rawDependabot({ state: "weird" }), "dependabot", "acme/api"),
    ).toBeNull();
  });
});

describe("parseRepos", () => {
  test("keeps well-formed, watched repo names only", () => {
    expect(
      parseRepos(
        [
          { nameWithOwner: "acme/web" },
          { nameWithOwner: "acme/api" },
          { nameWithOwner: "acme/api" },
          { nameWithOwner: "acme/thing-sandbox" },
          { nameWithOwner: "globex/other" },
          { nameWithOwner: "acme/$(curl evil)" },
          null,
        ],
        owners,
      ),
    ).toEqual(["acme/api", "acme/web"]);
  });
});

describe("keys and urls", () => {
  test("are built from repo, type and number", () => {
    expect(alertKey(alert())).toBe("acme/api#alert-dependabot-4");
    expect(alertUrl(alert())).toBe(
      "https://github.com/acme/api/security/dependabot/4",
    );
    expect(alertUrl(alert({ alertType: "code_scanning" }))).toBe(
      "https://github.com/acme/api/security/code-scanning/4",
    );
    expect(alertUrl(alert({ alertType: "secret_scanning" }))).toBe(
      "https://github.com/acme/api/security/secret-scanning/4",
    );
  });

  test("an event line carries the alert's type, severity and package", () => {
    expect(
      alertEvent(
        "me",
        "acme",
        alert(),
        "opened",
        new Date("2026-01-02T03:04:05Z"),
      ),
    ).toEqual({
      account: "me",
      alert_type: "dependabot",
      at: "2026-01-02T03:04:05.000Z",
      client: "acme",
      event: "opened",
      key: "acme/api#alert-dependabot-4:opened",
      kind: "alert",
      number: 4,
      package: "left-pad",
      repo: "acme/api",
      severity: "critical",
      sha: null,
      v: 1,
    });
  });
});

describe("diffAlerts", () => {
  const now = "2026-01-02T03:04:05.000Z";

  test("a new alert is opened; a missing one is gone", () => {
    const kept = alert({ number: 1, since: "2026-01-01T00:00:00.000Z" });
    const result = diffAlerts(
      [kept, alert({ number: 2 })],
      [alert({ number: 1 }), alert({ number: 3 })],
      false,
      now,
    );
    expect(result.opened.map((a) => a.number)).toEqual([3]);
    expect(result.gone.map((a) => a.number)).toEqual([2]);
    expect(result.next).toEqual([kept, alert({ number: 3, since: now })]);
  });

  test("the first check of a repo and type is a silent baseline", () => {
    const result = diffAlerts([], [alert()], true, now);
    expect(result.opened).toEqual([]);
    expect(result.next).toEqual([alert({ since: now })]);
  });

  test("closedEvent maps a looked-up alert to fixed or dismissed", () => {
    expect(closedEvent(alert({ state: "FIXED" }))).toBe("fixed");
    expect(closedEvent(alert({ state: "DISMISSED" }))).toBe("dismissed");
    expect(closedEvent(alert())).toBeNull();
    expect(closedEvent(null)).toBeNull();
  });
});

describe("pickChecks", () => {
  const now = new Date("2026-01-02T00:00:00Z");

  test("never-checked pairs first, then the oldest, up to the limit", () => {
    const picked = pickChecks(
      ["acme/api", "acme/web"],
      {
        "acme/api|code_scanning": { at: "2026-01-01T23:00:00.000Z" },
        "acme/api|dependabot": { at: "2026-01-01T22:00:00.000Z" },
        "acme/api|secret_scanning": { at: "2026-01-01T23:30:00.000Z" },
        "acme/web|dependabot": { at: "2026-01-01T21:00:00.000Z" },
      },
      now,
      4,
    );
    expect(picked).toEqual([
      { repo: "acme/web", type: "code_scanning" },
      { repo: "acme/web", type: "secret_scanning" },
      { repo: "acme/web", type: "dependabot" },
      { repo: "acme/api", type: "dependabot" },
    ]);
  });

  test("a pair without access waits a day before it is tried again", () => {
    const checks = (at: string) =>
      pickChecks(
        ["acme/api"],
        {
          "acme/api|code_scanning": { at, denied: true },
          "acme/api|dependabot": { at: "2026-01-01T23:59:00.000Z" },
          "acme/api|secret_scanning": { at: "2026-01-01T23:59:00.000Z" },
        },
        now,
        10,
      ).map((c) => c.type);
    expect(checks("2026-01-01T12:00:00.000Z")).not.toContain("code_scanning");
    expect(checks("2025-12-31T23:00:00.000Z")).toContain("code_scanning");
  });
});
