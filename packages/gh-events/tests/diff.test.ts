import { describe, expect, test } from "bun:test";

import { diffGone, diffOpen, toEvent } from "../src/diff";
import { SHA_A, SHA_B, snap } from "./fixtures";

describe("diffOpen", () => {
  test("emits approved once, on the transition", () => {
    expect(diffOpen(snap(), snap({ review: "APPROVED" })).events).toEqual([
      "approved",
    ]);
    expect(
      diffOpen(snap({ review: "APPROVED" }), snap({ review: "APPROVED" }))
        .events,
    ).toEqual([]);
  });

  test("emits ci_failed per failing head commit", () => {
    expect(diffOpen(snap(), snap({ ci: "FAILURE" })).events).toEqual([
      "ci_failed",
    ]);
    expect(
      diffOpen(snap({ ci: "FAILURE" }), snap({ ci: "FAILURE" })).events,
    ).toEqual([]);
    expect(
      diffOpen(snap({ ci: "FAILURE" }), snap({ ci: "ERROR", sha: SHA_B }))
        .events,
    ).toEqual(["ci_failed"]);
    expect(diffOpen(snap(), snap({ ci: "PENDING" })).events).toEqual([]);
  });

  test("emits conflict on the transition and ignores a lazy UNKNOWN", () => {
    expect(diffOpen(snap(), snap({ mergeable: "CONFLICTING" })).events).toEqual(
      ["conflict"],
    );
    const unknown = diffOpen(
      snap({ mergeable: "CONFLICTING" }),
      snap({ mergeable: "UNKNOWN" }),
    );
    expect(unknown.events).toEqual([]);
    expect(unknown.next.mergeable).toBe("CONFLICTING");
    expect(
      diffOpen(unknown.next, snap({ mergeable: "CONFLICTING" })).events,
    ).toEqual([]);
  });

  test("a PR seen for the first time reports its current state", () => {
    expect(
      diffOpen(undefined, snap({ ci: "FAILURE", mergeable: "CONFLICTING" }))
        .events,
    ).toEqual(["ci_failed", "conflict"]);
  });
});

describe("diffGone", () => {
  test("only a merge is an event", () => {
    expect(diffGone(snap({ state: "MERGED" }))).toEqual(["merged"]);
    expect(diffGone(snap({ state: "CLOSED" }))).toEqual([]);
    expect(diffGone(snap({ state: "OPEN" }))).toEqual([]);
    expect(diffGone(null)).toEqual([]);
  });
});

test("toEvent builds a stable key", () => {
  const e = toEvent("me", snap(), "approved", new Date("2026-01-02T03:04:05Z"));
  expect(e).toEqual({
    account: "me",
    at: "2026-01-02T03:04:05.000Z",
    event: "approved",
    key: `acme/api#12:approved:${SHA_A}`,
    pr: 12,
    repo: "acme/api",
    sha: SHA_A,
  });
});

describe("settling", () => {
  test("a baseline UNKNOWN that resolves to CONFLICTING is not an event", () => {
    const first = diffOpen(
      snap({ mergeable: "UNKNOWN", settling: true }),
      snap({ mergeable: "UNKNOWN" }),
    );
    expect(first.next.settling).toBe(true);
    const resolved = diffOpen(first.next, snap({ mergeable: "CONFLICTING" }));
    expect(resolved.events).toEqual([]);
    expect(resolved.next.settling).toBeUndefined();
    expect(
      diffOpen(resolved.next, snap({ mergeable: "MERGEABLE" })).events,
    ).toEqual([]);
  });

  test("a new PR outside the baseline still reports a conflict", () => {
    const first = diffOpen(undefined, snap({ mergeable: "UNKNOWN" }));
    expect(
      diffOpen(first.next, snap({ mergeable: "CONFLICTING" })).events,
    ).toEqual(["conflict"]);
  });
});
