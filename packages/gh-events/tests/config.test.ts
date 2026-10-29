import { describe, expect, test } from "bun:test";

import { parseConfig } from "../src/config";
import { searchString } from "../src/github";
import { LABEL, plist } from "../src/launchd";

describe("parseConfig", () => {
  test("reads per-repo client overrides by lowercase repo name", () => {
    const config = parseConfig({
      accounts: [
        {
          login: "me",
          owners: [
            {
              client: "acme",
              name: "acme",
              repos: { "Special-API": "special", old: null },
            },
          ],
        },
      ],
    });
    expect(config.accounts[0]?.owners[0]?.repos).toEqual({
      old: null,
      "special-api": "special",
    });
  });

  test("fills defaults", () => {
    const config = parseConfig({
      accounts: [{ login: "me_acme", owners: [{ name: "acme", repos: {} }] }],
    });
    expect(config).toEqual({
      accounts: [
        {
          login: "me_acme",
          owners: [
            {
              client: null,
              exclude: [],
              include: ["*"],
              kind: "org",
              name: "acme",
              repos: {},
              unreleased: [],
            },
          ],
        },
      ],
      intervalSeconds: 60,
    });
  });

  test.each([
    ["no accounts", { accounts: [] }],
    [
      "a bad login",
      { accounts: [{ login: "me;rm", owners: [{ name: "acme", repos: {} }] }] },
    ],
    [
      "a bad owner",
      { accounts: [{ login: "me", owners: [{ name: "acme org" }] }] },
    ],
    [
      "a bad kind",
      {
        accounts: [
          { login: "me", owners: [{ kind: "team", name: "acme", repos: {} }] },
        ],
      },
    ],
    [
      "a query operator in a glob",
      {
        accounts: [
          {
            login: "me",
            owners: [{ include: ["a OR b"], name: "acme", repos: {} }],
          },
        ],
      },
    ],
    [
      "repos as an array",
      {
        accounts: [{ login: "me", owners: [{ name: "acme", repos: ["api"] }] }],
      },
    ],
    [
      "a repo name with a slash",
      {
        accounts: [
          {
            login: "me",
            owners: [{ name: "acme", repos: { "acme/api": "x" } }],
          },
        ],
      },
    ],
    [
      "a repo client with spaces",
      {
        accounts: [
          { login: "me", owners: [{ name: "acme", repos: { api: "a b" } }] },
        ],
      },
    ],
    [
      "a client with spaces",
      {
        accounts: [
          {
            login: "me",
            owners: [{ client: "acme corp", name: "acme", repos: {} }],
          },
        ],
      },
    ],
    [
      "a short interval",
      {
        accounts: [{ login: "me", owners: [{ name: "acme", repos: {} }] }],
        intervalSeconds: 5,
      },
    ],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseConfig(raw)).toThrow();
  });
});

test("searchString uses one qualifier per owner", () => {
  expect(
    searchString("issue", "assignee", [
      {
        client: null,
        exclude: [],
        include: ["*"],
        kind: "org",
        name: "acme",
        repos: {},
        unreleased: [],
      },
      {
        client: null,
        exclude: [],
        include: ["*"],
        kind: "user",
        name: "globex",
        repos: {},
        unreleased: [],
      },
    ]),
  ).toBe("is:issue is:open archived:false assignee:@me org:acme user:globex");
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
