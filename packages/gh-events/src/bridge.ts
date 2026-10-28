/**
 * Moves tasks in the task database (tasks-mcp) along with their pull
 * requests. A task names its pull requests as `owner/repo#number`. Each poll
 * records how far each PR has got, and the PRs that moved are queued. A sync
 * then sets each task linking a queued PR to the least advanced stage among
 * its PRs, and only ever moves a task forward.
 */
import type { Config } from "./config";
import type { GhEvent } from "./diff";
import type { Item } from "./guard";

import { unreleased } from "./guard";

/** How far a PR has got. `closed` is closed without merging. */
export type Stage =
  "approved" | "closed" | "doing" | "done" | "merged" | "review";

/** Task states in the order work moves through them. */
export const ORDER = [
  "todo",
  "doing",
  "review",
  "approved",
  "merged",
  "done",
] as const;

export type TaskState = (typeof ORDER)[number];

/** What the bridge remembers between polls, inside state.json. */
export interface BridgeState {
  /** PR keys whose stage changed and whose tasks are not synced yet. */
  pending: string[];
  /** The last known stage of each PR, by key. */
  stages: Record<string, Stage>;
}

/** A task as task_search returns it, reduced to what the sync reads. */
export interface TaskSummary {
  id: string;
  pullRequests?: string[];
  revision: number;
  state: string;
}

const STAGE_LIMIT = 5000;
const PENDING_LIMIT = 1000;

/** `owner/repo#number` in lower case, the form task_search matches. */
export const prKey = (repo: string, number: number): string =>
  `${repo.toLowerCase()}#${number}`;

/** The stage of an open PR. A draft is still being worked on. */
export function openStage(item: Item): Stage {
  if (item.state === "DRAFT") return "doing";
  return item.review === "APPROVED" ? "approved" : "review";
}

/** The stage an event moves a PR to, or null for an event that does not. */
export function eventStage(event: GhEvent, config: Config): null | Stage {
  if (event.kind !== "pr") return null;
  const owners = config.accounts.find((a) => a.login === event.account)?.owners;
  switch (event.event) {
    case "approved":
      return "approved";
    case "closed":
      return "closed";
    case "merged":
      return owners && unreleased(event.repo, owners) ? "done" : "merged";
    case "released":
      return "done";
    default:
      return null;
  }
}

/**
 * The bridge state after a poll: open PRs take their current stage, then the
 * poll's events apply on top. Every PR whose stage changed is queued.
 */
export function advance(
  prev: BridgeState | undefined,
  config: Config,
  open: readonly Item[],
  events: readonly GhEvent[],
): BridgeState {
  const stages: Record<string, Stage> = { ...(prev?.stages ?? {}) };
  const pending = new Set(prev?.pending ?? []);
  const set = (key: string, stage: Stage): void => {
    if (stages[key] === stage) return;
    // Re-inserting keeps the most recently changed PRs at the end, so the
    // oldest are the ones dropped at the limit.
    delete stages[key];
    stages[key] = stage;
    pending.add(key);
  };
  for (const item of open)
    if (item.kind === "pr") set(prKey(item.repo, item.number), openStage(item));
  for (const event of events) {
    const stage = eventStage(event, config);
    if (stage) set(prKey(event.repo, event.number), stage);
  }
  const keys = Object.keys(stages);
  for (const key of keys.slice(0, Math.max(0, keys.length - STAGE_LIMIT)))
    delete stages[key];
  return { pending: [...pending].slice(-PENDING_LIMIT), stages };
}

const rank = (state: string): number =>
  (ORDER as readonly string[]).indexOf(state);

/**
 * The state a task should move to, or null to leave it. The target is the
 * least advanced stage among the task's PRs. A PR the bridge has not seen
 * counts as in review, and a PR closed without merging is left out. Done,
 * dropped and unknown states are never changed.
 */
export function target(
  task: TaskSummary,
  stages: Readonly<Record<string, Stage>>,
): null | TaskState {
  const current = rank(task.state);
  if (current < 0 || task.state === "done") return null;
  const reached = (task.pullRequests ?? [])
    .map((ref): Stage => stages[ref.toLowerCase()] ?? "review")
    .filter((stage): stage is Exclude<Stage, "closed"> => stage !== "closed");
  if (reached.length === 0) return null;
  const least = reached.reduce((a, b) => (rank(b) < rank(a) ? b : a));
  return rank(least) > current ? least : null;
}

/** The two task-database calls the sync makes. Real runs use tasks-mcp. */
export interface TasksApi {
  /** Open tasks linking this PR. */
  search(pr: string): Promise<TaskSummary[]>;
  /** Set a task's state at the revision read, past another agent's claim. */
  update(
    id: string,
    revision: number,
    state: TaskState,
    note: string,
  ): Promise<void>;
}

/**
 * Syncs the tasks of each queued PR, oldest first. A PR leaves the queue once
 * its tasks are synced. The first failure stops the sync and keeps that PR
 * and the rest queued, so a task server that is down is retried next poll.
 */
export async function sync(
  bridge: BridgeState,
  api: TasksApi,
): Promise<{ error?: string; moved: number; pending: string[] }> {
  const pending = [...bridge.pending];
  let moved = 0;
  while (pending.length > 0) {
    const key = pending[0] as string;
    try {
      for (const task of await api.search(key)) {
        const next = target(task, bridge.stages);
        if (!next) continue;
        await api.update(
          task.id,
          task.revision,
          next,
          `gh-events: ${key} is ${bridge.stages[key] ?? "linked"}`,
        );
        moved++;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "unknown error";
      return { error, moved, pending };
    }
    pending.shift();
  }
  return { moved, pending };
}
