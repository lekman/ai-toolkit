import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../src/config";
import type { Item } from "../src/guard";

import { type Registry, runPoll, type Source } from "../src/poll";
import { issue, owners, pr } from "./fixtures";

const config: Config = {
  accounts: [{ login: "me", owners }],
  intervalSeconds: 60,
};

function files() {
  const dir = mkdtempSync(join(tmpdir(), "gh-events-"));
  return {
    events: join(dir, "events.jsonl"),
    registry: join(dir, "registry.json"),
    state: join(dir, "state.json"),
  };
}

function source(open: Item[], nodes: Item[] = []): Source {
  return {
    nodes: async (_a, ids) =>
      new Map(nodes.filter((n) => ids.includes(n.id)).map((n) => [n.id, n])),
    open: async () => ({
      cost: 1,
      dropped: 0,
      items: new Map(open.map((s) => [s.id, s])),
    }),
  };
}

const events = (path: string): { event: string; number: number }[] =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const registry = (path: string): Registry =>
  JSON.parse(readFileSync(path, "utf8"));

describe("runPoll", () => {
  test("the first poll is a silent baseline", async () => {
    const f = files();
    const [report] = await runPoll(config, source([pr({ ci: "FAILURE" })]), f);
    expect(report?.events).toBe(0);
    expect(() => readFileSync(f.events)).toThrow();
    expect(statSync(f.state).mode & 0o777).toBe(0o600);
  });

  test("writes transitions, merges, closed issues, and never the same key twice", async () => {
    const f = files();
    await runPoll(
      config,
      source([pr({ id: "PR_1" }), pr({ id: "PR_2", number: 13 }), issue()]),
      f,
    );
    await runPoll(
      config,
      source(
        [pr({ id: "PR_1", review: "APPROVED" })],
        [
          pr({ id: "PR_2", number: 13, state: "MERGED" }),
          issue({ closedAt: "2026-01-02T03:04:05Z", state: "CLOSED" }),
        ],
      ),
      f,
    );
    // PR_1 drops out of search briefly and comes back still approved.
    await runPoll(config, source([]), f);
    await runPoll(config, source([pr({ id: "PR_1", review: "APPROVED" })]), f);
    expect(events(f.events)).toEqual([
      expect.objectContaining({ event: "approved", number: 12 }),
      expect.objectContaining({ event: "merged", number: 13 }),
      expect.objectContaining({ event: "issue_closed", number: 7 }),
    ]);
  });

  test("a failing account keeps its items and is marked failed", async () => {
    const f = files();
    await runPoll(config, source([pr({ id: "PR_1" })]), f);
    const broken: Source = {
      ...source([]),
      open: async () => {
        throw new Error("GitHub GraphQL HTTP 502");
      },
    };
    const [report] = await runPoll(config, broken, f);
    expect(report?.error).toBe("GitHub GraphQL HTTP 502");
    expect(registry(f.registry).accounts[0]).toEqual(
      expect.objectContaining({
        error: "GitHub GraphQL HTTP 502",
        login: "me",
        ok: false,
      }),
    );
    expect(registry(f.registry).items).toHaveLength(1);
    await runPoll(config, source([pr({ ci: "FAILURE", id: "PR_1" })]), f);
    expect(events(f.events)).toEqual([
      expect.objectContaining({ event: "ci_failed" }),
    ]);
  });

  test("an account that fails before any success takes its baseline later", async () => {
    const f = files();
    const broken: Source = {
      ...source([]),
      open: async () => {
        throw new Error("down");
      },
    };
    await runPoll(config, broken, f);
    await runPoll(config, source([pr({ ci: "FAILURE" })]), f);
    expect(() => readFileSync(f.events)).toThrow();
  });

  test("the baseline marks UNKNOWN PRs as settling", async () => {
    const f = files();
    await runPoll(config, source([pr({ mergeable: "UNKNOWN" })]), f);
    await runPoll(config, source([pr({ mergeable: "CONFLICTING" })]), f);
    expect(() => readFileSync(f.events)).toThrow();
  });

  test("a version 1 state keeps its keys and takes a new baseline", async () => {
    const f = files();
    writeFileSync(
      f.state,
      JSON.stringify({
        accounts: { me: { prs: {} } },
        seen: ["old"],
        version: 1,
      }),
    );
    await runPoll(config, source([pr({ ci: "FAILURE" })]), f);
    expect(() => readFileSync(f.events)).toThrow();
    expect(JSON.parse(readFileSync(f.state, "utf8")).seen).toEqual(["old"]);
  });
});

describe("registry.json", () => {
  test("lists every item with client, url and first-seen time", async () => {
    const f = files();
    const now = new Date("2026-01-02T03:04:05Z");
    await runPoll(
      config,
      source([
        pr({ closes: [7], state: "DRAFT" }),
        issue(),
        pr({ id: "PR_3", number: 3, repo: "globex/api" }),
        issue({ id: "I_2", number: 2, repo: "acme/special-api" }),
      ]),
      f,
      now,
    );
    const reg = registry(f.registry);
    expect(reg.version).toBe(1);
    expect(reg.generatedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(reg.accounts).toEqual([
      {
        error: null,
        login: "me",
        ok: true,
        polledAt: "2026-01-02T03:04:05.000Z",
      },
    ]);
    expect(
      reg.items.map((i) => [i.repo, i.number, i.kind, i.client, i.url]),
    ).toEqual([
      ["acme/api", 7, "issue", "acme", "https://github.com/acme/api/issues/7"],
      ["acme/api", 12, "pr", "acme", "https://github.com/acme/api/pull/12"],
      [
        "acme/special-api",
        2,
        "issue",
        "special",
        "https://github.com/acme/special-api/issues/2",
      ],
      ["globex/api", 3, "pr", null, "https://github.com/globex/api/pull/3"],
    ]);
    expect(reg.items[1]).toEqual(
      expect.objectContaining({
        closes: [7],
        since: "2026-01-02T03:04:05.000Z",
        state: "DRAFT",
      }),
    );
    expect(statSync(f.registry).mode & 0o777).toBe(0o600);
  });

  test("keeps first-seen time across polls", async () => {
    const f = files();
    await runPoll(config, source([pr()]), f, new Date("2026-01-01T00:00:00Z"));
    await runPoll(config, source([pr()]), f, new Date("2026-01-02T00:00:00Z"));
    expect(registry(f.registry).items[0]?.since).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});
