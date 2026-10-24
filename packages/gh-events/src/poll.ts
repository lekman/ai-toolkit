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
import type { PrSnapshot } from "./guard";

import { diffGone, diffOpen, type PrEvent, toEvent } from "./diff";

/** What the poller remembers between runs. */
export interface State {
  accounts: Record<string, { prs: Record<string, PrSnapshot> }>;
  /** Recent event keys, newest last, so a key is never written twice. */
  seen: string[];
  version: 1;
}

/** Where PR data comes from. Real runs use GitHub; tests pass a stub. */
export interface Source {
  nodes(
    account: Account,
    ids: readonly string[],
  ): Promise<Map<string, PrSnapshot>>;
  open(
    account: Account,
  ): Promise<{ cost: number; dropped: number; prs: Map<string, PrSnapshot> }>;
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

/**
 * Polls one account. The first poll of an account stores a baseline and emits
 * nothing, so existing failures and approvals do not flood the log.
 */
export async function pollAccount(
  account: Account,
  prev: undefined | { prs: Record<string, PrSnapshot> },
  source: Source,
  now: Date,
): Promise<{
  cost: number;
  dropped: number;
  events: PrEvent[];
  prs: Record<string, PrSnapshot>;
}> {
  const { cost, dropped, prs: open } = await source.open(account);
  const events: PrEvent[] = [];
  const prs: Record<string, PrSnapshot> = {};

  for (const [id, snap] of open) {
    const { events: names, next } = diffOpen(prev?.prs[id], snap);
    if (!prev && next.mergeable === "UNKNOWN") next.settling = true;
    prs[id] = next;
    if (prev)
      for (const name of names)
        events.push(toEvent(account.login, next, name, now));
  }

  const gone = prev ? Object.keys(prev.prs).filter((id) => !open.has(id)) : [];
  if (gone.length > 0) {
    const found = await source.nodes(account, gone);
    for (const id of gone) {
      const lookup = found.get(id) ?? null;
      for (const name of diffGone(lookup)) {
        if (lookup) events.push(toEvent(account.login, lookup, name, now));
      }
    }
  }
  return { cost, dropped, events, prs };
}

/** Reads the state file. A missing file is an empty state. */
export function loadState(path: string): State {
  if (!existsSync(path)) return { accounts: {}, seen: [], version: 1 };
  const state = JSON.parse(readFileSync(path, "utf8")) as State;
  if (state.version !== 1) throw new Error(`state: unknown version in ${path}`);
  return state;
}

function writePrivate(path: string, content: string): void {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Runs one poll over every account: diffs, appends new events, then saves
 * state. An account that fails keeps its old state and is reported; the
 * others still run.
 */
export async function runPoll(
  config: Config,
  source: Source,
  files: { events: string; state: string },
  now = new Date(),
): Promise<AccountReport[]> {
  const state = loadState(files.state);
  const seen = new Set(state.seen);
  const fresh: PrEvent[] = [];
  const reports: AccountReport[] = [];

  for (const account of config.accounts) {
    try {
      const result = await pollAccount(
        account,
        state.accounts[account.login],
        source,
        now,
      );
      const events = result.events.filter((e) => !seen.has(e.key));
      for (const e of events) seen.add(e.key);
      fresh.push(...events);
      state.accounts[account.login] = { prs: result.prs };
      reports.push({
        cost: result.cost,
        dropped: result.dropped,
        events: events.length,
        login: account.login,
        open: Object.keys(result.prs).length,
      });
    } catch (err) {
      reports.push({
        cost: 0,
        dropped: 0,
        error: err instanceof Error ? err.message : "unknown error",
        events: 0,
        login: account.login,
        open: 0,
      });
    }
  }

  // Events first: a crash between the two writes repeats an event at worst,
  // and the next run's state still matches what the log holds.
  if (fresh.length > 0) {
    mkdirSync(dirname(files.events), { mode: 0o700, recursive: true });
    appendFileSync(
      files.events,
      fresh.map((e) => JSON.stringify(e)).join("\n") + "\n",
      {
        mode: 0o600,
      },
    );
  }
  state.seen = [...seen].slice(-SEEN_LIMIT);
  writePrivate(files.state, JSON.stringify(state));
  return reports;
}
