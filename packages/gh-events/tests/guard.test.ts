import { describe, expect, test } from "bun:test";

import { parsePr, watched } from "../src/guard";
import { owners, rawPr, SHA_A } from "./fixtures";

describe("parsePr", () => {
  test("keeps only the fixed fields and drops free text", () => {
    const snap = parsePr(rawPr(), owners);
    expect(snap).toEqual({
      ci: "SUCCESS",
      id: "PR_kwDOabc123",
      mergeable: "MERGEABLE",
      pr: 12,
      repo: "acme/api",
      review: "REVIEW_REQUIRED",
      sha: SHA_A,
      state: "OPEN",
    });
    expect(JSON.stringify(snap)).not.toContain("instructions");
  });

  test("accepts a null review decision and a commit without checks", () => {
    const snap = parsePr(
      rawPr({
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        reviewDecision: null,
      }),
      owners,
    );
    expect(snap?.review).toBeNull();
    expect(snap?.ci).toBeNull();
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
  ])("rejects %s", (_label, overrides) => {
    expect(parsePr(rawPr(overrides), owners)).toBeNull();
  });

  test("rejects non-objects and empty search hits", () => {
    expect(parsePr(null, owners)).toBeNull();
    expect(parsePr([], owners)).toBeNull();
    expect(parsePr({}, owners)).toBeNull();
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
      { exclude: [], include: ["a.b"], kind: "org" as const, name: "acme" },
    ];
    expect(watched("acme/a.b", literal)).toBe(true);
    expect(watched("acme/axb", literal)).toBe(false);
  });
});
