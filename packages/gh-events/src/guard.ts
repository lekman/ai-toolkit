/**
 * The guard between GitHub and this machine. Every value that leaves it is an
 * enum, an integer, a 40-hex SHA, an ISO timestamp, or a repo name that
 * matched both a strict pattern and the configured allow-list. Titles, branch
 * names, bodies and logins never pass, so nothing a PR or issue author writes
 * reaches the registry or the event log.
 */
import type { Owner } from "./config";

/** Review decision GitHub reports for a PR. */
export type Review = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

/** Merge state. GitHub computes it lazily, so `UNKNOWN` is common. */
export type Mergeable = "CONFLICTING" | "MERGEABLE" | "UNKNOWN";

/** Combined state of every check and status on the head commit. */
export type Ci = "ERROR" | "EXPECTED" | "FAILURE" | "PENDING" | "SUCCESS";

/** Item state. `DRAFT` is an open PR marked as a draft; issues have no draft. */
export type ItemState = "CLOSED" | "DRAFT" | "MERGED" | "OPEN";

/** A pull request or an issue. */
export type Kind = "issue" | "pr";

/** One PR or issue, reduced to the fields the poller compares. */
export interface Item {
  /** Issues only: the item came from the assignee search. Set by the poller. */
  assigned?: true;
  ci: Ci | null;
  /** Issues only: when it was closed, or null while open. */
  closedAt: null | string;
  /** PRs only: issue numbers in the same repo this PR closes. Sorted. */
  closes: number[];
  /** GraphQL node id. Kept in state for the lookup, never logged. */
  id: string;
  kind: Kind;
  mergeable: Mergeable | null;
  number: number;
  repo: string;
  review: null | Review;
  /** Set by the poller, never by GitHub. See `diffOpen`. */
  settling?: true;
  sha: null | string;
  /** When the poller first saw the item. Set by the poller. */
  since?: string;
  state: ItemState;
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
const PR_STATES = ["CLOSED", "MERGED", "OPEN"] as const;
const ISSUE_STATES = ["CLOSED", "OPEN"] as const;

const NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/;
const REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
const SHA = /^[0-9a-f]{40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MAX_CLOSES = 50;

const oneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): T | undefined => list.find((item) => item === value);

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 1e8;

/** Turns a `*` glob into an anchored, case-insensitive pattern. */
function glob(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
}

/** The configured owner of a repo, if the repo name is well formed. */
export function ownerOf(
  repo: string,
  owners: readonly Owner[],
): Owner | undefined {
  const ownerName = REPO.exec(repo)?.[1]?.toLowerCase();
  return owners.find((o) => o.name.toLowerCase() === ownerName);
}

/**
 * The client id for a repo: its entry in the owner's `repos`, else the
 * owner's `client`, else null.
 */
export function clientFor(
  repo: string,
  owners: readonly Owner[],
): null | string {
  const owner = ownerOf(repo, owners);
  const name = REPO.exec(repo)?.[2]?.toLowerCase();
  if (!owner || !name) return null;
  return name in owner.repos ? (owner.repos[name] ?? null) : owner.client;
}

/**
 * True when the repo's owner is configured and the repo name passes that
 * owner's include list and none of its exclude patterns.
 */
export function watched(repo: string, owners: readonly Owner[]): boolean {
  const name = REPO.exec(repo)?.[2];
  const owner = ownerOf(repo, owners);
  if (!name || !owner) return false;
  return (
    owner.include.some((p) => glob(p).test(name)) &&
    !owner.exclude.some((p) => glob(p).test(name))
  );
}

/** Issue numbers from `closingIssuesReferences`, same repo only. */
function closes(raw: unknown, repo: string): number[] | undefined {
  const nodes = record(raw)?.nodes;
  if (!Array.isArray(nodes)) return undefined;
  const numbers = new Set<number>();
  for (const node of nodes) {
    const ref = record(node);
    const refRepo = record(ref?.repository)?.nameWithOwner;
    if (!isNumber(ref?.number) || typeof refRepo !== "string") return undefined;
    if (refRepo.toLowerCase() === repo.toLowerCase()) numbers.add(ref.number);
  }
  return [...numbers].sort((a, b) => a - b).slice(0, MAX_CLOSES);
}

function parsePr(
  node: Record<string, unknown>,
  base: Pick<Item, "id" | "number" | "repo">,
): Item | null {
  const sha = node.headRefOid;
  if (typeof sha !== "string" || !SHA.test(sha)) return null;
  const githubState = oneOf(PR_STATES, node.state);
  const mergeable = oneOf(MERGEABLE, node.mergeable);
  if (!githubState || !mergeable || typeof node.isDraft !== "boolean")
    return null;
  const state: ItemState =
    githubState === "OPEN" && node.isDraft ? "DRAFT" : githubState;

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

  const closed = closes(node.closingIssuesReferences, base.repo);
  if (!closed) return null;

  return {
    ...base,
    ci,
    closedAt: null,
    closes: closed,
    kind: "pr",
    mergeable,
    review,
    sha,
    state,
  };
}

function parseIssue(
  node: Record<string, unknown>,
  base: Pick<Item, "id" | "number" | "repo">,
): Item | null {
  const state = oneOf(ISSUE_STATES, node.state);
  const closedAt = node.closedAt;
  if (!state) return null;
  if (
    closedAt !== null &&
    (typeof closedAt !== "string" || !ISO.test(closedAt))
  )
    return null;
  return {
    ...base,
    ci: null,
    closedAt,
    closes: [],
    kind: "issue",
    mergeable: null,
    review: null,
    sha: null,
    state,
  };
}

/**
 * Validates one GraphQL `PullRequest` or `Issue` node. Returns `null` when any
 * field is missing or out of shape, or when the repo is not watched.
 */
export function parseItem(raw: unknown, owners: readonly Owner[]): Item | null {
  const node = record(raw);
  if (!node) return null;

  const id = node.id;
  const number = node.number;
  const repo = record(node.repository)?.nameWithOwner;
  if (typeof id !== "string" || !NODE_ID.test(id)) return null;
  if (!isNumber(number)) return null;
  if (typeof repo !== "string" || !watched(repo, owners)) return null;

  const base = { id, number, repo };
  if (node.__typename === "PullRequest") return parsePr(node, base);
  if (node.__typename === "Issue") return parseIssue(node, base);
  return null;
}

/** The item's page on GitHub, built from validated fields only. */
export function itemUrl(item: Pick<Item, "kind" | "number" | "repo">): string {
  const path = item.kind === "pr" ? "pull" : "issues";
  return `https://github.com/${item.repo}/${path}/${item.number}`;
}
