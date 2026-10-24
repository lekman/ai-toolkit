/**
 * The guard between GitHub and this machine. Every value that leaves it is an
 * enum, an integer, a 40-hex SHA, or a repo name that matched both a strict
 * pattern and the configured allow-list. Titles, branch names, bodies and
 * logins never pass, so nothing a PR author writes reaches the event log.
 */
import type { Owner } from "./config";

/** Review decision GitHub reports for a PR. */
export type Review = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

/** Merge state. GitHub computes it lazily, so `UNKNOWN` is common. */
export type Mergeable = "CONFLICTING" | "MERGEABLE" | "UNKNOWN";

/** Combined state of every check and status on the head commit. */
export type Ci = "ERROR" | "EXPECTED" | "FAILURE" | "PENDING" | "SUCCESS";

/** PR lifecycle state. */
export type PrState = "CLOSED" | "MERGED" | "OPEN";

/** One PR, reduced to the fields the poller compares. */
export interface PrSnapshot {
  ci: Ci | null;
  /** GraphQL node id. Kept in state for the merge lookup, never logged. */
  id: string;
  mergeable: Mergeable;
  pr: number;
  repo: string;
  review: null | Review;
  sha: string;
  /** Set by the poller, never by GitHub. See `diffOpen`. */
  settling?: true;
  state: PrState;
}

const REVIEWS: readonly Review[] = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_REQUIRED",
];
const MERGEABLE: readonly Mergeable[] = ["CONFLICTING", "MERGEABLE", "UNKNOWN"];
const CI: readonly Ci[] = [
  "ERROR",
  "EXPECTED",
  "FAILURE",
  "PENDING",
  "SUCCESS",
];
const STATES: readonly PrState[] = ["CLOSED", "MERGED", "OPEN"];

const NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/;
const REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
const SHA = /^[0-9a-f]{40}$/;

const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): T | undefined => list.find((item) => item === value);

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Turns a `*` glob into an anchored, case-insensitive pattern. */
function glob(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}

/**
 * True when the repo's owner is configured and the repo name passes that
 * owner's include list and none of its exclude patterns.
 */
export function watched(repo: string, owners: readonly Owner[]): boolean {
  const match = REPO.exec(repo);
  if (!match) return false;
  const [, ownerName = "", name = ""] = match;
  const owner = owners.find(
    (o) => o.name.toLowerCase() === ownerName.toLowerCase(),
  );
  if (!owner) return false;
  return (
    owner.include.some((p) => glob(p).test(name)) &&
    !owner.exclude.some((p) => glob(p).test(name))
  );
}

/**
 * Validates one GraphQL `PullRequest` node. Returns `null` when any field is
 * missing or out of shape, or when the repo is not watched.
 */
export function parsePr(
  raw: unknown,
  owners: readonly Owner[],
): null | PrSnapshot {
  const node = record(raw);
  if (!node) return null;

  const id = node.id;
  const pr = node.number;
  const sha = node.headRefOid;
  const repo = record(node.repository)?.nameWithOwner;
  if (typeof id !== "string" || !NODE_ID.test(id)) return null;
  if (typeof pr !== "number" || !Number.isInteger(pr) || pr < 1 || pr > 1e8)
    return null;
  if (typeof sha !== "string" || !SHA.test(sha)) return null;
  if (typeof repo !== "string" || !watched(repo, owners)) return null;

  const state = oneOf(STATES, node.state);
  const mergeable = oneOf(MERGEABLE, node.mergeable);
  if (!state || !mergeable) return null;

  // reviewDecision is null on repos without required reviews.
  const review =
    node.reviewDecision === null ? null : oneOf(REVIEWS, node.reviewDecision);
  if (review === undefined) return null;

  const commits = record(node.commits)?.nodes;
  const head = Array.isArray(commits) ? record(commits[0]) : undefined;
  const rollup = record(record(head?.commit)?.statusCheckRollup);
  // A commit with no checks has no rollup at all.
  const ci = rollup ? oneOf(CI, rollup.state) : null;
  if (ci === undefined) return null;

  return { ci, id, mergeable, pr, repo, review, sha, state };
}
