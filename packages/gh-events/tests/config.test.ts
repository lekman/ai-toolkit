import { describe, expect, test } from "bun:test";

import { parseConfig } from "../src/config";
import { searchString } from "../src/github";
import { LABEL, plist } from "../src/launchd";

describe("parseConfig", () => {
  test("fills defaults", () => {
    const config = parseConfig({
      accounts: [{ login: "me_acme", owners: [{ name: "acme" }] }],
    });
    expect(config).toEqual({
      accounts: [
        {
          login: "me_acme",
          owners: [{ exclude: [], include: ["*"], kind: "org", name: "acme" }],
        },
      ],
      intervalSeconds: 60,
    });
  });

  test.each([
    ["no accounts", { accounts: [] }],
    [
      "a bad login",
      { accounts: [{ login: "me;rm", owners: [{ name: "acme" }] }] },
    ],
    [
      "a bad owner",
      { accounts: [{ login: "me", owners: [{ name: "acme org" }] }] },
    ],
    [
      "a bad kind",
      { accounts: [{ login: "me", owners: [{ kind: "team", name: "acme" }] }] },
    ],
    [
      "a query operator in a glob",
      {
        accounts: [
          { login: "me", owners: [{ include: ["a OR b"], name: "acme" }] },
        ],
      },
    ],
    [
      "a short interval",
      {
        accounts: [{ login: "me", owners: [{ name: "acme" }] }],
        intervalSeconds: 5,
      },
    ],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseConfig(raw)).toThrow();
  });
});

test("searchString uses one qualifier per owner", () => {
  expect(
    searchString("review-requested", [
      { exclude: [], include: ["*"], kind: "org", name: "acme" },
      { exclude: [], include: ["*"], kind: "user", name: "globex" },
    ]),
  ).toBe(
    "is:pr is:open archived:false review-requested:@me org:acme user:globex",
  );
});

test("plist runs poll on the interval and escapes paths", () => {
  const xml = plist({
    bun: "/opt/bun",
    cli: "/a&b/cli.ts",
    interval: 90,
    log: "/logs/x.log",
    path: "/usr/bin",
  });
  expect(xml).toContain(`<string>${LABEL}</string>`);
  expect(xml).toContain("<integer>90</integer>");
  expect(xml).toContain("<string>/a&amp;b/cli.ts</string>");
  expect(xml).toContain("<string>poll</string>");
});
