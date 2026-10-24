import type { Account, Owner } from "./config";

import { type Item, parseItem } from "./guard";

const ENDPOINT = "https://api.github.com/graphql";
const PAGE = 50;

const FRAGMENTS = `fragment pr on PullRequest {
  __typename id number state isDraft headRefOid reviewDecision mergeable
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  closingIssuesReferences(first: 10) { nodes { number repository { nameWithOwner } } }
}
fragment issue on Issue {
  __typename id number state closedAt
  repository { nameWithOwner }
}`;

/** The four searches run each poll, all in one request. */
const SEARCHES = {
  issueAssigned: { role: "assignee", type: "issue" },
  issueMine: { role: "author", type: "issue" },
  prMine: { role: "author", type: "pr" },
  prReview: { role: "review-requested", type: "pr" },
} as const;

type Alias = keyof typeof SEARCHES;
const ALIASES = Object.keys(SEARCHES) as Alias[];

// One request carries every search. GitHub prices a request from the query
// text, before it runs: each nested connection costs one unit per possible
// parent. So an issue search selects only issue fields, or it would pay for
// the PR connections too. Each alias is dropped once its own pages run out.
const OPEN_QUERY = `query(${ALIASES.map((a) => `$${a}: String!, $${a}After: String, $${a}Do: Boolean!`).join(", ")}) {
  rateLimit { cost remaining }
${ALIASES.map(
  (
    a,
  ) => `  ${a}: search(type: ISSUE, query: $${a}, first: ${PAGE}, after: $${a}After) @include(if: $${a}Do) {
    pageInfo { hasNextPage endCursor } nodes { ...${SEARCHES[a].type === "pr" ? "pr" : "issue"} }
  }`,
).join("\n")}
}
${FRAGMENTS}`;

const NODES_QUERY = `query($ids: [ID!]!) { nodes(ids: $ids) { ...pr ...issue } }
${FRAGMENTS}`;

interface SearchPage {
  nodes?: unknown[];
  pageInfo?: { endCursor?: null | string; hasNextPage?: boolean };
}

/** The search string for one search across an account's owners. */
export function searchString(
  type: "issue" | "pr",
  role: "assignee" | "author" | "review-requested",
  owners: readonly Owner[],
): string {
  const scope = owners.map((o) => `${o.kind}:${o.name}`).join(" ");
  return `is:${type} is:open archived:false ${role}:@me ${scope}`;
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
 * Open PRs the account authored or was asked to review, and open issues it
 * authored or is assigned, in watched repos. Returns the guarded items keyed
 * by node id, and how many raw nodes the guard dropped. Issues from the
 * assignee search are marked `assigned`.
 */
export async function fetchOpen(
  account: Account,
  auth: string,
): Promise<{ cost: number; dropped: number; items: Map<string, Item> }> {
  const items = new Map<string, Item>();
  let dropped = 0;
  let cost = 0;
  const cursor = new Map<Alias, null | string>();
  const more = new Set<Alias>(ALIASES);

  while (more.size > 0) {
    const variables: Record<string, unknown> = {};
    for (const alias of ALIASES) {
      const { role, type } = SEARCHES[alias];
      variables[alias] = searchString(type, role, account.owners);
      variables[`${alias}After`] = cursor.get(alias) ?? null;
      variables[`${alias}Do`] = more.has(alias);
    }
    const data = await graphql(auth, OPEN_QUERY, variables);
    cost += Number(
      (data.rateLimit as { cost?: number } | undefined)?.cost ?? 0,
    );
    for (const alias of [...more]) {
      const page = data[alias] as SearchPage | undefined;
      for (const raw of page?.nodes ?? []) {
        const item = parseItem(raw, account.owners);
        if (!item) {
          dropped++;
          continue;
        }
        const known = items.get(item.id);
        if (alias === "issueAssigned" || known?.assigned) item.assigned = true;
        items.set(item.id, item);
      }
      if (page?.pageInfo?.hasNextPage === true)
        cursor.set(alias, page.pageInfo.endCursor ?? null);
      else more.delete(alias);
    }
  }
  return { cost, dropped, items };
}

/**
 * Looks up PRs and issues by node id. A missing entry means the item could
 * not be read or failed the guard.
 */
export async function fetchNodes(
  account: Account,
  auth: string,
  ids: readonly string[],
): Promise<Map<string, Item>> {
  const found = new Map<string, Item>();
  for (let i = 0; i < ids.length; i += PAGE) {
    const data = await graphql(
      auth,
      NODES_QUERY,
      { ids: ids.slice(i, i + PAGE) },
      true,
    );
    for (const raw of (data.nodes as unknown[] | undefined) ?? []) {
      const item = parseItem(raw, account.owners);
      if (item) found.set(item.id, item);
    }
  }
  return found;
}
