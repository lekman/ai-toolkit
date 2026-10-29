import type { Ci, Item } from "./guard";

/** The notifications this package emits. */
export type EventName =
  | "approved"
  | "ci_failed"
  | "closed"
  | "conflict"
  | "issue_assigned"
  | "issue_closed"
  | "merged"
  | "released";

/** One line of `events.jsonl`. See CONTRACT.md. */
export interface GhEvent {
  account: string;
  at: string;
  client: null | string;
  event: EventName;
  /** `repo#number:event:discriminator`; never written twice. */
  key: string;
  kind: Item["kind"];
  number: number;
  repo: string;
  sha: null | string;
  v: 1;
}

const failed = (ci: Ci | null): boolean => ci === "FAILURE" || ci === "ERROR";

/**
 * Compares an open item with what the last poll stored. Returns the events
 * for the transitions and the item to store next.
 *
 * For PRs, `UNKNOWN` mergeability keeps the last known value, so a lazy
 * recompute is not read as a change. A PR stored by the baseline while still
 * `UNKNOWN` stays `settling` until GitHub computes the value, and that first
 * value is stored without an event.
 */
export function diffOpen(
  prev: Item | undefined,
  cur: Item,
): { events: EventName[]; next: Item } {
  const next: Item = { ...cur };
  delete next.settling;
  if (prev?.since) next.since = prev.since;

  if (cur.kind === "issue") {
    const events: EventName[] =
      cur.assigned && !prev?.assigned ? ["issue_assigned"] : [];
    return { events, next };
  }

  const mergeable =
    cur.mergeable === "UNKNOWN"
      ? (prev?.mergeable ?? "UNKNOWN")
      : cur.mergeable;
  const settling = prev?.settling === true && prev.mergeable === "UNKNOWN";
  next.mergeable = mergeable;
  if (settling && mergeable === "UNKNOWN") next.settling = true;

  const events: EventName[] = [];
  if (cur.review === "APPROVED" && prev?.review !== "APPROVED")
    events.push("approved");
  if (failed(cur.ci) && !(prev && failed(prev.ci) && prev.sha === cur.sha))
    events.push("ci_failed");
  if (
    !settling &&
    mergeable === "CONFLICTING" &&
    prev?.mergeable !== "CONFLICTING"
  )
    events.push("conflict");
  return { events, next };
}

/**
 * Decides what an item that left the open search means. A merged PR, a PR
 * closed without merging and a closed issue are events. An item that left
 * scope while open, and an item that can no longer be read, are dropped
 * without one.
 */
export function diffGone(lookup: Item | null): EventName[] {
  if (lookup?.kind === "pr" && lookup.state === "MERGED") return ["merged"];
  if (lookup?.kind === "pr" && lookup.state === "CLOSED") return ["closed"];
  if (lookup?.kind === "issue" && lookup.state === "CLOSED")
    return ["issue_closed"];
  return [];
}

/** Builds the log line for one event. */
export function toEvent(
  account: string,
  client: null | string,
  item: Item,
  event: EventName,
  at: Date,
): GhEvent {
  const discriminator = item.sha ?? item.closedAt ?? "-";
  return {
    account,
    at: at.toISOString(),
    client,
    event,
    key: `${item.repo}#${item.number}:${event}:${discriminator}`,
    kind: item.kind,
    number: item.number,
    repo: item.repo,
    sha: item.sha,
    v: 1,
  };
}
