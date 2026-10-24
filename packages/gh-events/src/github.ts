import type { Account, Owner } from "./config";

import { parsePr, type PrSnapshot } from "./guard";

const ENDPOINT = "https://api.github.com/graphql";
// 50 keeps a search request at 1 point; 100 doubled it, measured.
const PAGE = 50;

const FRAGMENT = `fragment pr on PullRequest {
  id number state headRefOid reviewDecision mergeable
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

// Both searches go in one request, so a poll costs 1 point per account.
// Each alias is dropped once its own pages run out.
const OPEN_QUERY = `query($mine: String!, $rev: String!, $mineAfter: String, $revAfter: String, $doMine: Boolean!, $doRev: Boolean!) {
  rateLimit { cost remaining }
  mine: search(type: ISSUE, query: $mine, first: ${PAGE}, after: $mineAfter) @include(if: $doMine) {
    pageInfo { hasNextPage endCursor } nodes { ...pr }
  }
  rev: search(type: ISSUE, query: $rev, first: ${PAGE}, after: $revAfter) @include(if: $doRev) {
    pageInfo { hasNextPage endCursor } nodes { ...pr }
  }
}
${FRAGMENT}`;

const NODES_QUERY = `query($ids: [ID!]!) { nodes(ids: $ids) { ...pr } }
${FRAGMENT}`;

interface SearchPage {
  nodes?: unknown[];
  pageInfo?: { endCursor?: null | string; hasNextPage?: boolean };
}

/** The search string for one role across an account's owners. */
export function searchString(
  role: "author" | "review-requested",
  owners: readonly Owner[],
): string {
  const scope = owners.map((o) => `${o.kind}:${o.name}`).join(" ");
  return `is:pr is:open archived:false ${role}:@me ${scope}`;
}

/** Reads an account's token from the `gh` keyring. Never logged. */
export function token(login: string): string {
  const out = Bun.spawnSync(["gh", "auth", "token", "--user", login], {
    stderr: "pipe",
  });
  const value = out.stdout.toString().trim();
  if (out.exitCode !== 0 || value === "")
    throw new Error(`no gh token for ${login}; run gh auth login`);
  return value;
}

async function graphql(
  auth: string,
  query: string,
  variables: Record<string, unknown>,
  partial = false,
): Promise<Record<string, unknown>> {
  const res = await fetch(ENDPOINT, {
    body: JSON.stringify({ query, variables }),
    headers: {
      authorization: `bearer ${auth}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  // Status only: the body is untrusted and stays out of the log.
  if (!res.ok) throw new Error(`GitHub GraphQL HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: Record<string, unknown>;
    errors?: unknown[];
  };
  // A node lookup reports NOT_FOUND per missing id next to the nodes it found.
  if (body.errors?.length && !(partial && body.data))
    throw new Error(`GitHub GraphQL returned ${body.errors.length} error(s)`);
  if (!body.data) throw new Error("GitHub GraphQL returned no data");
  return body.data;
}

/**
 * Open PRs the account authored or was asked to review, in watched repos.
 * Returns the guarded snapshots, keyed by node id, and how many raw nodes the
 * guard dropped.
 */
export async function fetchOpen(
  account: Account,
  auth: string,
): Promise<{ cost: number; dropped: number; prs: Map<string, PrSnapshot> }> {
  const prs = new Map<string, PrSnapshot>();
  let dropped = 0;
  let cost = 0;
  const cursor = { mine: null as null | string, rev: null as null | string };
  const more = { mine: true, rev: true };

  while (more.mine || more.rev) {
    const data = await graphql(auth, OPEN_QUERY, {
      doMine: more.mine,
      doRev: more.rev,
      mine: searchString("author", account.owners),
      mineAfter: cursor.mine,
      rev: searchString("review-requested", account.owners),
      revAfter: cursor.rev,
    });
    cost += Number(
      (data.rateLimit as { cost?: number } | undefined)?.cost ?? 0,
    );
    for (const alias of ["mine", "rev"] as const) {
      if (!more[alias]) continue;
      const page = data[alias] as SearchPage | undefined;
      for (const raw of page?.nodes ?? []) {
        const snap = parsePr(raw, account.owners);
        if (snap) prs.set(snap.id, snap);
        else dropped++;
      }
      more[alias] = page?.pageInfo?.hasNextPage === true;
      cursor[alias] = page?.pageInfo?.endCursor ?? null;
    }
  }
  return { cost, dropped, prs };
}

/**
 * Looks up PRs by node id. A missing entry means the PR could not be read or
 * failed the guard.
 */
export async function fetchNodes(
  account: Account,
  auth: string,
  ids: readonly string[],
): Promise<Map<string, PrSnapshot>> {
  const found = new Map<string, PrSnapshot>();
  for (let i = 0; i < ids.length; i += PAGE) {
    const data = await graphql(
      auth,
      NODES_QUERY,
      { ids: ids.slice(i, i + PAGE) },
      true,
    );
    for (const raw of (data.nodes as unknown[] | undefined) ?? []) {
      const snap = parsePr(raw, account.owners);
      if (snap) found.set(snap.id, snap);
    }
  }
  return found;
}
