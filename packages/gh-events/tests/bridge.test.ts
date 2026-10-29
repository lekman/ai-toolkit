import { describe, expect, test } from "bun:test";

import type { Config } from "../src/config";
import type { GhEvent } from "../src/diff";

import {
  advance,
  type BridgeState,
  sync,
  target,
  type TasksApi,
  type TaskSummary,
} from "../src/bridge";
import { owners, pr } from "./fixtures";

const config: Config = {
  accounts: [{ login: "me", owners }],
  intervalSeconds: 60,
};

function event(
  name: GhEvent["event"],
  repo = "acme/api",
  number = 12,
): GhEvent {
  return {
    account: "me",
    at: "2026-01-02T03:04:05.000Z",
    client: "acme",
    event: name,
    key: `${repo}#${number}:${name}:-`,
    kind: "pr",
    number,
    repo,
    sha: null,
    v: 1,
  };
}

const task = (
  state: string,
  pullRequests: string[],
  id = "t1",
): TaskSummary => ({ id, pullRequests, revision: 3, state });

describe("advance", () => {
  test("open PRs take their stage and every change is queued", () => {
    const next = advance(
      undefined,
      config,
      [
        pr(),
        pr({ id: "PR_2", number: 13, review: "APPROVED" }),
        pr({ id: "PR_3", number: 14, state: "DRAFT" }),
      ],
      [],
    );
    expect(next.stages).toEqual({
      "acme/api#12": "review",
      "acme/api#13": "approved",
      "acme/api#14": "doing",
    });
    expect(next.pending).toEqual(["acme/api#12", "acme/api#13", "acme/api#14"]);
  });

  test("events move PRs on; an unchanged stage is not queued again", () => {
    const prev: BridgeState = {
      pending: [],
      stages: { "acme/api#12": "approved", "acme/api#13": "merged" },
    };
    const next = advance(
      prev,
      config,
      [],
      [
        event("merged"),
        event("released", "acme/api", 13),
        event("merged", "acme/infra-dns", 4),
        event("closed", "acme/api", 15),
        event("ci_failed", "acme/api", 16),
      ],
    );
    expect(next.stages).toEqual({
      "acme/api#12": "merged",
      "acme/api#13": "done",
      "acme/api#15": "closed",
      "acme/infra-dns#4": "done",
    });
    expect(next.pending).toEqual([
      "acme/api#12",
      "acme/api#13",
      "acme/infra-dns#4",
      "acme/api#15",
    ]);
    expect(advance(next, config, [], []).pending).toEqual(next.pending);
  });
});

describe("target", () => {
  const stages = {
    "acme/api#12": "merged",
    "acme/api#13": "approved",
    "acme/api#14": "closed",
    "acme/api#15": "done",
  } as const;

  test("moves a task forward to its least advanced PR", () => {
    expect(target(task("doing", ["acme/api#12"]), stages)).toBe("merged");
    expect(target(task("review", ["Acme/API#12", "acme/api#13"]), stages)).toBe(
      "approved",
    );
    expect(target(task("merged", ["acme/api#15"]), stages)).toBe("done");
  });

  test("never moves a task back, and leaves done and dropped alone", () => {
    expect(target(task("merged", ["acme/api#13"]), stages)).toBe(null);
    expect(target(task("done", ["acme/api#15"]), stages)).toBe(null);
    expect(target(task("dropped", ["acme/api#15"]), stages)).toBe(null);
  });

  test("an unseen PR counts as review, and a closed one is left out", () => {
    expect(target(task("todo", ["acme/api#99", "acme/api#15"]), stages)).toBe(
      "review",
    );
    expect(target(task("review", ["acme/api#14", "acme/api#15"]), stages)).toBe(
      "done",
    );
    expect(target(task("review", ["acme/api#14"]), stages)).toBe(null);
    expect(target(task("review", []), stages)).toBe(null);
  });
});

describe("sync", () => {
  function api(tasks: Record<string, TaskSummary[]>, failOn?: string) {
    const updates: [string, string, string][] = [];
    const client: TasksApi = {
      search: async (key) => {
        if (key === failOn) throw new Error("tasks server HTTP 502");
        return tasks[key] ?? [];
      },
      update: async (id, _revision, state, note) => {
        updates.push([id, state, note]);
      },
    };
    return { client, updates };
  }

  test("moves each linked task and empties the queue", async () => {
    const { client, updates } = api({
      "acme/api#12": [task("review", ["acme/api#12"])],
      "acme/api#13": [task("approved", ["acme/api#13"], "t2")],
    });
    const result = await sync(
      {
        pending: ["acme/api#12", "acme/api#13"],
        stages: { "acme/api#12": "approved", "acme/api#13": "approved" },
      },
      client,
    );
    expect(result).toEqual({ moved: 1, pending: [] });
    expect(updates).toEqual([
      ["t1", "approved", "gh-events: acme/api#12 is approved"],
    ]);
  });

  test("a failure keeps that PR and the rest queued", async () => {
    const { client } = api({}, "acme/api#13");
    const result = await sync(
      {
        pending: ["acme/api#12", "acme/api#13", "acme/api#14"],
        stages: {},
      },
      client,
    );
    expect(result).toEqual({
      error: "tasks server HTTP 502",
      moved: 0,
      pending: ["acme/api#13", "acme/api#14"],
    });
  });
});
