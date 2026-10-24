import { describe, expect, test } from "bun:test";

import { clientFor, itemUrl, parseItem, watched } from "../src/guard";
import { owners, rawIssue, rawPr, SHA_A } from "./fixtures";

describe("parseItem: pull requests", () => {
  test("keeps only the fixed fields and drops free text", () => {
    const item = parseItem(rawPr(), owners);
    expect(item).toEqual({
      ci: "SUCCESS",
      closedAt: null,
      closes: [3, 7],
      id: "PR_kwDOabc123",
      kind: "pr",
      mergeable: "MERGEABLE",
      number: 12,
      repo: "acme/api",
      review: "REVIEW_REQUIRED",
      sha: SHA_A,
      state: "OPEN",
    });
    const text = JSON.stringify(item);
    expect(text).not.toContain("instructions");
    expect(text).not.toContain("curl");
  });

  test("an open draft is DRAFT; a merged draft flag does not hide MERGED", () => {
    expect(parseItem(rawPr({ isDraft: true }), owners)?.state).toBe("DRAFT");
    expect(
      parseItem(rawPr({ isDraft: true, state: "MERGED" }), owners)?.state,
    ).toBe("MERGED");
  });

  test("accepts a null review decision and a commit without checks", () => {
    const item = parseItem(
      rawPr({
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        reviewDecision: null,
      }),
      owners,
    );
    expect(item?.review).toBeNull();
    expect(item?.ci).toBeNull();
  });

  test.each([
    ["an unknown enum", { mergeable: "MAYBE" }],
    ["an unknown review", { reviewDecision: "LGTM" }],
    [
      "an unknown CI state",
      {
        commits: {
          nodes: [{ commit: { statusCheckRollup: { state: "BROKEN" } } }],
        },
      },
    ],
    ["a missing draft flag", { isDraft: undefined }],
    ["a short SHA", { headRefOid: "abc123" }],
    ["text in the SHA", { headRefOid: `${"a".repeat(39)}\n` }],
    ["a string number", { number: "12" }],
    ["a fractional number", { number: 1.5 }],
    [
      "a repo with a newline",
      { repository: { nameWithOwner: "acme/api\nrm" } },
    ],
    [
      "a repo outside the allow-list",
      { repository: { nameWithOwner: "initech/api" } },
    ],
    [
      "an excluded repo",
      { repository: { nameWithOwner: "acme/demo-sandbox" } },
    ],
    ["a node id with spaces", { id: "PR 1" }],
    [
      "a closing reference with a text number",
      {
        closingIssuesReferences: {
          nodes: [{ number: "7", repository: { nameWithOwner: "acme/api" } }],
        },
      },
    ],
    ["missing closing references", { closingIssuesReferences: null }],
    ["an unknown type", { __typename: "Discussion" }],
  ])("rejects %s", (_label, overrides) => {
    expect(parseItem(rawPr(overrides), owners)).toBeNull();
  });

  test("rejects non-objects and empty search hits", () => {
    expect(parseItem(null, owners)).toBeNull();
    expect(parseItem([], owners)).toBeNull();
    expect(parseItem({}, owners)).toBeNull();
  });
});

describe("parseItem: issues", () => {
  test("keeps only the fixed fields", () => {
    const item = parseItem(rawIssue(), owners);
    expect(item).toEqual({
      ci: null,
      closedAt: null,
      closes: [],
      id: "I_kwDOabc456",
      kind: "issue",
      mergeable: null,
      number: 7,
      repo: "acme/api",
      review: null,
      sha: null,
      state: "OPEN",
    });
    expect(JSON.stringify(item)).not.toContain("token");
  });

  test("accepts a closed issue with an ISO closedAt", () => {
    expect(
      parseItem(
        rawIssue({ closedAt: "2026-01-02T03:04:05Z", state: "CLOSED" }),
        owners,
      )?.closedAt,
    ).toBe("2026-01-02T03:04:05Z");
  });

  test.each([
    ["a merged state", { state: "MERGED" }],
    ["text in closedAt", { closedAt: "yesterday" }],
  ])("rejects %s", (_label, overrides) => {
    expect(parseItem(rawIssue(overrides), owners)).toBeNull();
  });
});

describe("watched", () => {
  test("matches owners case-insensitively and applies include and exclude", () => {
    expect(watched("ACME/api", owners)).toBe(true);
    expect(watched("acme/demo-sandbox", owners)).toBe(false);
    expect(watched("globex/api", owners)).toBe(true);
    expect(watched("globex/web-shop", owners)).toBe(true);
    expect(watched("globex/infra", owners)).toBe(false);
    expect(watched("initech/api", owners)).toBe(false);
  });

  test("treats glob characters other than * literally", () => {
    const literal = [
      {
        client: null,
        exclude: [],
        include: ["a.b"],
        kind: "org" as const,
        name: "acme",
        repos: {},
      },
    ];
    expect(watched("acme/a.b", literal)).toBe(true);
    expect(watched("acme/axb", literal)).toBe(false);
  });
});

test("itemUrl uses the fixed forms", () => {
  expect(itemUrl({ kind: "pr", number: 12, repo: "acme/api" })).toBe(
    "https://github.com/acme/api/pull/12",
  );
  expect(itemUrl({ kind: "issue", number: 7, repo: "acme/api" })).toBe(
    "https://github.com/acme/api/issues/7",
  );
});

describe("clientFor", () => {
  test("a repo entry wins over the owner default, case-insensitively", () => {
    expect(clientFor("acme/api", owners)).toBe("acme");
    expect(clientFor("acme/Special-API", owners)).toBe("special");
    expect(clientFor("globex/api", owners)).toBeNull();
    expect(clientFor("initech/api", owners)).toBeNull();
  });

  test("a repo entry of null holds that repo as unknown", () => {
    const held = [{ ...owners[0]!, repos: { api: null } }];
    expect(clientFor("acme/api", held)).toBeNull();
    expect(clientFor("acme/web", held)).toBe("acme");
  });
});
