import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../src/config";
import type { PrSnapshot } from "../src/guard";

import { runPoll, type Source } from "../src/poll";
import { owners, snap } from "./fixtures";

const config: Config = {
  accounts: [{ login: "me", owners }],
  intervalSeconds: 60,
};

function files() {
  const dir = mkdtempSync(join(tmpdir(), "gh-events-"));
  return { events: join(dir, "events.jsonl"), state: join(dir, "state.json") };
}

function source(open: PrSnapshot[], nodes: PrSnapshot[] = []): Source {
  return {
    nodes: async (_a, ids) =>
      new Map(nodes.filter((n) => ids.includes(n.id)).map((n) => [n.id, n])),
    open: async () => ({
      cost: 1,
      dropped: 0,
      prs: new Map(open.map((s) => [s.id, s])),
    }),
  };
}

const events = (path: string): { event: string; pr: number }[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("runPoll", () => {
  test("the first poll is a silent baseline", async () => {
    const f = files();
    const [report] = await runPoll(
      config,
      source([snap({ ci: "FAILURE" })]),
      f,
    );
    expect(report?.events).toBe(0);
    expect(() => readFileSync(f.events)).toThrow();
    expect(statSync(f.state).mode & 0o777).toBe(0o600);
  });

  test("writes transitions, merges, and never the same key twice", async () => {
    const f = files();
    await runPoll(
      config,
      source([snap({ id: "PR_1" }), snap({ id: "PR_2", pr: 13 })]),
      f,
    );
    await runPoll(
      config,
      source(
        [snap({ id: "PR_1", review: "APPROVED" })],
        [snap({ id: "PR_2", pr: 13, state: "MERGED" })],
      ),
      f,
    );
    // PR_1 drops out of search briefly and comes back still approved.
    await runPoll(config, source([]), f);
    await runPoll(
      config,
      source([snap({ id: "PR_1", review: "APPROVED" })]),
      f,
    );
    expect(events(f.events)).toEqual([
      expect.objectContaining({ event: "approved", pr: 12 }),
      expect.objectContaining({ event: "merged", pr: 13 }),
    ]);
  });

  test("a failing account keeps its state and reports the error", async () => {
    const f = files();
    await runPoll(config, source([snap({ id: "PR_1" })]), f);
    const broken: Source = {
      ...source([]),
      open: async () => {
        throw new Error("GitHub GraphQL HTTP 502");
      },
    };
    const [report] = await runPoll(config, broken, f);
    expect(report?.error).toBe("GitHub GraphQL HTTP 502");
    await runPoll(config, source([snap({ ci: "FAILURE", id: "PR_1" })]), f);
    expect(events(f.events)).toEqual([
      expect.objectContaining({ event: "ci_failed" }),
    ]);
  });
});

test("the baseline marks UNKNOWN PRs as settling", async () => {
  const f = files();
  await runPoll(config, source([snap({ mergeable: "UNKNOWN" })]), f);
  await runPoll(config, source([snap({ mergeable: "CONFLICTING" })]), f);
  expect(() => readFileSync(f.events)).toThrow();
});
