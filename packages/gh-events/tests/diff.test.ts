import { describe, expect, test } from "bun:test";

import { diffGone, diffOpen, toEvent } from "../src/diff";
import { issue, pr, SHA_A, SHA_B } from "./fixtures";

describe("diffOpen: pull requests", () => {
  test("emits approved once, on the transition", () => {
    expect(diffOpen(pr(), pr({ review: "APPROVED" })).events).toEqual([
      "approved",
    ]);
    expect(
      diffOpen(pr({ review: "APPROVED" }), pr({ review: "APPROVED" })).events,
    ).toEqual([]);
  });

  test("emits ci_failed per failing head commit", () => {
    expect(diffOpen(pr(), pr({ ci: "FAILURE" })).events).toEqual(["ci_failed"]);
    expect(
      diffOpen(pr({ ci: "FAILURE" }), pr({ ci: "FAILURE" })).events,
    ).toEqual([]);
    expect(
      diffOpen(pr({ ci: "FAILURE" }), pr({ ci: "ERROR", sha: SHA_B })).events,
    ).toEqual(["ci_failed"]);
    expect(diffOpen(pr(), pr({ ci: "PENDING" })).events).toEqual([]);
  });

  test("emits conflict on the transition and ignores a lazy UNKNOWN", () => {
    expect(diffOpen(pr(), pr({ mergeable: "CONFLICTING" })).events).toEqual([
      "conflict",
    ]);
    const unknown = diffOpen(
      pr({ mergeable: "CONFLICTING" }),
      pr({ mergeable: "UNKNOWN" }),
    );
    expect(unknown.events).toEqual([]);
    expect(unknown.next.mergeable).toBe("CONFLICTING");
    expect(
      diffOpen(unknown.next, pr({ mergeable: "CONFLICTING" })).events,
    ).toEqual([]);
  });

  test("a PR seen for the first time reports its current state", () => {
    expect(
      diffOpen(undefined, pr({ ci: "FAILURE", mergeable: "CONFLICTING" }))
        .events,
    ).toEqual(["ci_failed", "conflict"]);
  });

  test("keeps the first-seen time", () => {
    expect(
      diffOpen(pr({ since: "2026-01-01T00:00:00.000Z" }), pr()).next.since,
    ).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("diffOpen: review requests and requested changes", () => {
  test("review_requested when a PR the account did not author enters the review search", () => {
    expect(diffOpen(undefined, pr({ reviewRequested: true })).events).toEqual([
      "review_requested",
    ]);
    // Still requested on the next poll: no repeat.
    expect(
      diffOpen(pr({ reviewRequested: true }), pr({ reviewRequested: true }))
        .events,
    ).toEqual([]);
    // A state from before this event existed has no flag, and still no repeat.
    expect(diffOpen(pr(), pr({ reviewRequested: true })).events).toEqual([]);
  });

  test("no review_requested on a PR the account authored", () => {
    expect(
      diffOpen(undefined, pr({ authored: true, reviewRequested: true })).events,
    ).toEqual([]);
  });

  test("changes_requested on the transition, for the account's own PR only", () => {
    expect(
      diffOpen(
        pr({ authored: true }),
        pr({ authored: true, review: "CHANGES_REQUESTED" }),
      ).events,
    ).toEqual(["changes_requested"]);
    expect(
      diffOpen(
        pr({ authored: true, review: "CHANGES_REQUESTED" }),
        pr({ authored: true, review: "CHANGES_REQUESTED", sha: SHA_B }),
      ).events,
    ).toEqual([]);
    expect(
      diffOpen(
        pr({ reviewRequested: true }),
        pr({ review: "CHANGES_REQUESTED", reviewRequested: true }),
      ).events,
    ).toEqual([]);
  });

  test("keys both by the head SHA", () => {
    const at = new Date();
    expect(toEvent("me", null, pr(), "review_requested", at).key).toBe(
      `acme/api#12:review_requested:${SHA_A}`,
    );
    expect(toEvent("me", null, pr(), "changes_requested", at).key).toBe(
      `acme/api#12:changes_requested:${SHA_A}`,
    );
  });
});

describe("diffOpen: issues", () => {
  test("emits issue_assigned once, when the issue enters the assignee search", () => {
    expect(diffOpen(undefined, issue({ assigned: true })).events).toEqual([
      "issue_assigned",
    ]);
    expect(diffOpen(issue(), issue({ assigned: true })).events).toEqual([
      "issue_assigned",
    ]);
    expect(
      diffOpen(issue({ assigned: true }), issue({ assigned: true })).events,
    ).toEqual([]);
    expect(diffOpen(undefined, issue()).events).toEqual([]);
  });
});

describe("settling", () => {
  test("a baseline UNKNOWN that resolves to CONFLICTING is not an event", () => {
    const first = diffOpen(
      pr({ mergeable: "UNKNOWN", settling: true }),
      pr({ mergeable: "UNKNOWN" }),
    );
    expect(first.next.settling).toBe(true);
    const resolved = diffOpen(first.next, pr({ mergeable: "CONFLICTING" }));
    expect(resolved.events).toEqual([]);
    expect(resolved.next.settling).toBeUndefined();
    expect(
      diffOpen(resolved.next, pr({ mergeable: "MERGEABLE" })).events,
    ).toEqual([]);
  });

  test("a new PR outside the baseline still reports a conflict", () => {
    const first = diffOpen(undefined, pr({ mergeable: "UNKNOWN" }));
    expect(
      diffOpen(first.next, pr({ mergeable: "CONFLICTING" })).events,
    ).toEqual(["conflict"]);
  });
});

describe("diffGone", () => {
  test("a merged PR, a closed PR and a closed issue are events", () => {
    expect(diffGone(pr({ state: "MERGED" }))).toEqual(["merged"]);
    expect(diffGone(pr({ state: "CLOSED" }))).toEqual(["closed"]);
    expect(
      diffGone(issue({ closedAt: "2026-01-02T03:04:05Z", state: "CLOSED" })),
    ).toEqual(["issue_closed"]);
  });

  test("anything else is dropped without an event", () => {
    expect(diffGone(pr({ state: "OPEN" }))).toEqual([]);
    expect(diffGone(issue())).toEqual([]);
    expect(diffGone(null)).toEqual([]);
  });
});

describe("toEvent", () => {
  test("builds a versioned line keyed by the head SHA", () => {
    expect(
      toEvent("me", "acme", pr(), "approved", new Date("2026-01-02T03:04:05Z")),
    ).toEqual({
      account: "me",
      at: "2026-01-02T03:04:05.000Z",
      client: "acme",
      event: "approved",
      key: `acme/api#12:approved:${SHA_A}`,
      kind: "pr",
      number: 12,
      repo: "acme/api",
      sha: SHA_A,
      v: 1,
    });
  });

  test("keys a closed issue by closedAt and an assignment by a dash", () => {
    const at = new Date();
    expect(
      toEvent(
        "me",
        null,
        issue({ closedAt: "2026-01-02T03:04:05Z" }),
        "issue_closed",
        at,
      ).key,
    ).toBe("acme/api#7:issue_closed:2026-01-02T03:04:05Z");
    expect(toEvent("me", null, issue(), "issue_assigned", at).key).toBe(
      "acme/api#7:issue_assigned:-",
    );
  });
});
