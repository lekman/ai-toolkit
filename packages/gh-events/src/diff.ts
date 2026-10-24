import type { Ci, PrSnapshot } from "./guard";

/** The four notifications this package emits. */
export type EventName = "approved" | "ci_failed" | "conflict" | "merged";

/** One line of `events.jsonl`. */
export interface PrEvent {
  account: string;
  at: string;
  event: EventName;
  /** `repo#pr:event:sha`; the same key is never written twice. */
  key: string;
  pr: number;
  repo: string;
  sha: string;
}

const failed = (ci: Ci | null): boolean => ci === "FAILURE" || ci === "ERROR";

/**
 * Compares a PR with what the last poll stored. Returns the events for the
 * transitions and the snapshot to store next. `UNKNOWN` mergeability keeps
 * the last known value, so a lazy recompute is not read as a change. A PR
 * stored by the baseline while still `UNKNOWN` stays `settling` until GitHub
 * computes the value, and that first value is stored without an event.
 */
export function diffOpen(
  prev: PrSnapshot | undefined,
  cur: PrSnapshot,
): { events: EventName[]; next: PrSnapshot } {
  const mergeable =
    cur.mergeable === "UNKNOWN"
      ? (prev?.mergeable ?? "UNKNOWN")
      : cur.mergeable;
  const settling = prev?.settling === true && prev.mergeable === "UNKNOWN";
  const next: PrSnapshot = { ...cur, mergeable };
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
 * Decides what a PR that left the open search means. Only a merge is an
 * event. A closed PR, a PR that left scope while open, and a PR that can no
 * longer be read are dropped without one.
 */
export function diffGone(lookup: null | PrSnapshot): EventName[] {
  return lookup?.state === "MERGED" ? ["merged"] : [];
}

/** Builds the log line for one event. */
export function toEvent(
  account: string,
  snap: PrSnapshot,
  event: EventName,
  at: Date,
): PrEvent {
  return {
    account,
    at: at.toISOString(),
    event,
    key: `${snap.repo}#${snap.pr}:${event}:${snap.sha}`,
    pr: snap.pr,
    repo: snap.repo,
    sha: snap.sha,
  };
}
