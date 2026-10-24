import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { Account, Config } from "./config";

import { diffGone, diffOpen, type GhEvent, toEvent } from "./diff";
import { type Item, itemUrl, ownerOf } from "./guard";

/** What the poller remembers about one account between runs. */
export interface AccountState {
  /** Why the latest poll failed. Absent when it succeeded. */
  error?: string;
  items: Record<string, Item>;
  /** When the latest successful poll ran, or null before the first one. */
  polledAt: null | string;
}

/** What the poller remembers between runs. */
export interface State {
  accounts: Record<string, AccountState>;
  /** Recent event keys, newest last, so a key is never written twice. */
  seen: string[];
  version: 2;
}

/** One row of `registry.json`. See CONTRACT.md. */
export interface RegistryItem {
  account: string;
  ci: Item["ci"];
  client: null | string;
  closes: number[];
  kind: Item["kind"];
  mergeable: Item["mergeable"];
  number: number;
  repo: string;
  review: Item["review"];
  sha: null | string;
  since: string;
  state: Item["state"];
  url: string;
}

/** `registry.json`: every monitored item, rewritten after each poll. */
export interface Registry {
  accounts: {
    error: null | string;
    login: string;
    ok: boolean;
    polledAt: null | string;
  }[];
  generatedAt: string;
  intervalSeconds: number;
  items: RegistryItem[];
  version: 1;
}

/** Where item data comes from. Real runs use GitHub; tests pass a stub. */
export interface Source {
  nodes(account: Account, ids: readonly string[]): Promise<Map<string, Item>>;
  open(
    account: Account,
  ): Promise<{ cost: number; dropped: number; items: Map<string, Item> }>;
}

/** One summary line per account, written to stdout for the launchd log. */
export interface AccountReport {
  cost: number;
  dropped: number;
  error?: string;
  events: number;
  login: string;
  open: number;
}

const SEEN_LIMIT = 5000;

const clientOf = (account: Account, repo: string): null | string =>
  ownerOf(repo, account.owners)?.client ?? null;

/**
 * Polls one account. Until an account has one successful poll, the poll
 * stores a baseline and emits nothing, so existing failures and approvals do
 * not flood the log.
 */
export async function pollAccount(
  account: Account,
  prev: AccountState | undefined,
  source: Source,
  now: Date,
): Promise<{
  cost: number;
  dropped: number;
  events: GhEvent[];
  items: Record<string, Item>;
}> {
  const baseline = !prev?.polledAt;
  const before = baseline ? {} : (prev?.items ?? {});
  const { cost, dropped, items: open } = await source.open(account);
  const events: GhEvent[] = [];
  const items: Record<string, Item> = {};
  const emit = (item: Item, names: readonly GhEvent["event"][]): void => {
    for (const name of names)
      events.push(
        toEvent(account.login, clientOf(account, item.repo), item, name, now),
      );
  };

  for (const [id, item] of open) {
    const { events: names, next } = diffOpen(before[id], item);
    next.since ??= now.toISOString();
    if (baseline && next.mergeable === "UNKNOWN") next.settling = true;
    items[id] = next;
    if (!baseline) emit(next, names);
  }

  const gone = Object.keys(before).filter((id) => !open.has(id));
  if (gone.length > 0) {
    const found = await source.nodes(account, gone);
    for (const id of gone) {
      const lookup = found.get(id) ?? null;
      if (lookup) emit(lookup, diffGone(lookup));
    }
  }
  return { cost, dropped, events, items };
}

/**
 * Reads the state file. A missing file is an empty state. A version 1 file
 * keeps its event keys and drops its PRs, so each account takes a new
 * baseline instead of reading the old shape.
 */
export function loadState(path: string): State {
  if (!existsSync(path)) return { accounts: {}, seen: [], version: 2 };
  const state = JSON.parse(readFileSync(path, "utf8")) as
    State | { seen?: string[]; version: 1 };
  if (state.version === 1)
    return { accounts: {}, seen: state.seen ?? [], version: 2 };
  if (state.version !== 2) throw new Error(`state: unknown version in ${path}`);
  return state;
}

/** Builds the registry from the state after a poll. */
export function buildRegistry(
  config: Config,
  state: State,
  now: Date,
): Registry {
  const items = new Map<string, RegistryItem>();
  for (const account of config.accounts) {
    for (const item of Object.values(
      state.accounts[account.login]?.items ?? {},
    )) {
      // An item two accounts can see is listed once, under the first account.
      const key = `${item.repo.toLowerCase()}#${item.number}`;
      if (items.has(key)) continue;
      items.set(key, {
        account: account.login,
        ci: item.ci,
        client: clientOf(account, item.repo),
        closes: item.closes,
        kind: item.kind,
        mergeable: item.mergeable,
        number: item.number,
        repo: item.repo,
        review: item.review,
        sha: item.sha,
        since: item.since ?? now.toISOString(),
        state: item.state,
        url: itemUrl(item),
      });
    }
  }
  return {
    accounts: config.accounts.map((a) => ({
      error: state.accounts[a.login]?.error ?? null,
      login: a.login,
      ok:
        !state.accounts[a.login]?.error && !!state.accounts[a.login]?.polledAt,
      polledAt: state.accounts[a.login]?.polledAt ?? null,
    })),
    generatedAt: now.toISOString(),
    intervalSeconds: config.intervalSeconds,
    items: [...items.values()].sort(
      (a, b) => a.repo.localeCompare(b.repo) || a.number - b.number,
    ),
    version: 1,
  };
}

function writePrivate(path: string, content: string): void {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Runs one poll over every account: diffs, appends new events, saves state,
 * then rewrites the registry. An account that fails keeps its old items, is
 * marked failed in the registry and is reported; the others still run.
 */
export async function runPoll(
  config: Config,
  source: Source,
  files: { events: string; registry: string; state: string },
  now = new Date(),
): Promise<AccountReport[]> {
  const state = loadState(files.state);
  const seen = new Set(state.seen);
  const fresh: GhEvent[] = [];
  const reports: AccountReport[] = [];

  for (const account of config.accounts) {
    const prev = state.accounts[account.login];
    try {
      const result = await pollAccount(account, prev, source, now);
      const events = result.events.filter((e) => !seen.has(e.key));
      for (const e of events) seen.add(e.key);
      fresh.push(...events);
      state.accounts[account.login] = {
        items: result.items,
        polledAt: now.toISOString(),
      };
      reports.push({
        cost: result.cost,
        dropped: result.dropped,
        events: events.length,
        login: account.login,
        open: Object.keys(result.items).length,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : "unknown error";
      state.accounts[account.login] = {
        error,
        items: prev?.items ?? {},
        polledAt: prev?.polledAt ?? null,
      };
      reports.push({
        cost: 0,
        dropped: 0,
        error,
        events: 0,
        login: account.login,
        open: 0,
      });
    }
  }

  // Events first: a crash between the writes repeats an event at worst, and
  // the next run's state still matches what the log holds. The log is only
  // ever appended to; see CONTRACT.md on rotation.
  if (fresh.length > 0) {
    mkdirSync(dirname(files.events), { mode: 0o700, recursive: true });
    appendFileSync(
      files.events,
      fresh.map((e) => JSON.stringify(e)).join("\n") + "\n",
      { mode: 0o600 },
    );
  }
  state.seen = [...seen].slice(-SEEN_LIMIT);
  writePrivate(files.state, JSON.stringify(state));
  writePrivate(
    files.registry,
    JSON.stringify(buildRegistry(config, state, now), null, 2) + "\n",
  );
  return reports;
}
