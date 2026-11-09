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

import {
  type Alert,
  alertEvent,
  type AlertEventName,
  type AlertFetch,
  alertKey,
  type AlertsState,
  type AlertType,
  alertUrl,
  checkKey,
  closedEvent,
  diffAlerts,
  parseRepos,
  pickChecks,
} from "./alerts";
import { advance, type BridgeState, sync, type TasksApi } from "./bridge";
import {
  diffGone,
  diffOpen,
  type EventName,
  type GhEvent,
  toEvent,
} from "./diff";
import { clientFor, type Item, itemUrl, unreleased } from "./guard";

/** A merged PR waiting for a release that contains its merge commit. */
export interface Shipping {
  /** The release commit last compared, so an unchanged release is not compared again. */
  checked?: string;
  mergedAt: string;
  mergeSha: string;
  number: number;
  repo: string;
  /** The PR's head SHA, which keys its events. */
  sha: null | string;
}

/** What the poller remembers about one account between runs. */
export interface AccountState {
  /** Open alerts and which repos and alert types were checked when. */
  alerts?: AlertsState;
  /** Why the latest poll failed. Absent when it succeeded. */
  error?: string;
  items: Record<string, Item>;
  /** When the latest successful poll ran, or null before the first one. */
  polledAt: null | string;
  /** Merged PRs waiting for a release, by node id. */
  shipping?: Record<string, Shipping>;
}

/** What the poller remembers between runs. */
export interface State {
  accounts: Record<string, AccountState>;
  /** PR stages and the PRs whose tasks still need a sync. */
  bridge?: BridgeState;
  /** Recent event keys, newest last, so a key is never written twice. */
  seen: string[];
  version: 2;
}

/** One row of `registry.json`. See CONTRACT.md. */
export interface RegistryItem {
  account: string;
  /** Alerts only. */
  alert_type?: AlertType;
  ci: Item["ci"];
  client: null | string;
  closes: number[];
  kind: "alert" | Item["kind"];
  mergeable: Item["mergeable"];
  number: number;
  /** Alerts only: the Dependabot package name, else null. */
  package?: null | string;
  repo: string;
  review: Item["review"];
  /** Alerts only. */
  severity?: Alert["severity"];
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
  /** One alert by number, to learn why it left the open list. */
  alert(
    account: Account,
    repo: string,
    type: AlertType,
    number: number,
  ): Promise<Alert | null>;
  /** The open alerts of one type in one repo. */
  alerts(account: Account, repo: string, type: AlertType): Promise<AlertFetch>;
  /** True when commit `head` contains commit `base`. */
  contains(
    account: Account,
    repo: string,
    base: string,
    head: string,
  ): Promise<boolean>;
  nodes(account: Account, ids: readonly string[]): Promise<Map<string, Item>>;
  open(
    account: Account,
  ): Promise<{ cost: number; dropped: number; items: Map<string, Item> }>;
  /** The commit each repo's latest release points at, or null. */
  releases(
    account: Account,
    repos: readonly string[],
  ): Promise<Map<string, null | string>>;
  /** Raw repository nodes under the account's owners, for the guard. */
  repos(account: Account): Promise<unknown[]>;
}

/** One summary line per account, written to stdout for the launchd log. */
export interface AccountReport {
  /** Repo and alert type pairs checked this poll. */
  alertChecks: number;
  /** Alert requests that failed this poll. They never fail the account. */
  alertErrors: number;
  /** Open alerts. */
  alerts: number;
  /** Repo and alert type pairs GitHub refused with a 403 or 404. */
  alertsDenied: number;
  cost: number;
  dropped: number;
  error?: string;
  events: number;
  login: string;
  open: number;
  /** Merged PRs still waiting for a release. */
  shipping: number;
}

const SEEN_LIMIT = 5000;

/** Repo and alert type pairs checked per account per poll. */
const ALERT_CHECKS_PER_POLL = 15;
/** Lookups of alerts that left the open list, per account per poll. */
const ALERT_LOOKUPS_PER_POLL = 50;
/** How often the list of repos to check for alerts is refreshed. */
const REPOS_REFRESH_MS = 3_600_000;

/** How long a merged PR is watched for a release before it is given up. */
const SHIPPING_DAYS = 180;

const clientOf = (account: Account, repo: string): null | string =>
  clientFor(repo, account.owners);

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
  alerts: AlertsState;
  alertsReport: { checks: number; denied: number; errors: number };
  cost: number;
  dropped: number;
  events: GhEvent[];
  items: Record<string, Item>;
  shipping: Record<string, Shipping>;
}> {
  const baseline = !prev?.polledAt;
  const before = baseline ? {} : (prev?.items ?? {});
  const { cost, dropped, items: open } = await source.open(account);
  const events: GhEvent[] = [];
  const items: Record<string, Item> = {};
  const emit = (item: Item, names: readonly EventName[]): void => {
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

  const shipping: Record<string, Shipping> = { ...(prev?.shipping ?? {}) };
  const gone = Object.keys(before).filter((id) => !open.has(id));
  if (gone.length > 0) {
    const found = await source.nodes(account, gone);
    for (const id of gone) {
      const lookup = found.get(id) ?? null;
      if (!lookup) continue;
      const names = diffGone(lookup);
      emit(lookup, names);
      if (
        names.includes("merged") &&
        lookup.mergeSha &&
        !unreleased(lookup.repo, account.owners)
      )
        shipping[id] = {
          mergedAt: now.toISOString(),
          mergeSha: lookup.mergeSha,
          number: lookup.number,
          repo: lookup.repo,
          sha: lookup.sha,
        };
    }
  }
  await checkReleases(account, shipping, source, now, (entry) =>
    emit(shipped(entry), ["released"]),
  );
  const alerts = await pollAlerts(
    account,
    prev?.alerts,
    source,
    now,
    (alert, name) =>
      events.push(
        alertEvent(
          account.login,
          clientOf(account, alert.repo),
          alert,
          name,
          now,
        ),
      ),
  );
  return {
    alerts: alerts.state,
    alertsReport: alerts,
    cost,
    dropped: dropped + alerts.dropped,
    events,
    items,
    shipping,
  };
}

/**
 * Checks up to ALERT_CHECKS_PER_POLL repo and alert type pairs, least
 * recently checked first, so every repo is reached in turn at a bounded cost.
 * The first successful read of a pair stores a baseline without events. An
 * alert that left the open list is looked up, and gives `fixed` or
 * `dismissed`; one that cannot be read is dropped without an event. A 403 or
 * 404 marks the pair as denied, drops its alerts quietly and is counted. Any
 * other error is counted and leaves the pair's alerts as they were, so alerts
 * never fail the account's poll.
 */
async function pollAlerts(
  account: Account,
  prev: AlertsState | undefined,
  source: Source,
  now: Date,
  emit: (alert: Alert, event: AlertEventName) => void,
): Promise<{
  checks: number;
  denied: number;
  dropped: number;
  errors: number;
  state: AlertsState;
}> {
  const at = now.toISOString();
  const state: AlertsState = {
    checked: { ...(prev?.checked ?? {}) },
    open: { ...(prev?.open ?? {}) },
    repos: prev?.repos ?? [],
    reposAt: prev?.reposAt ?? null,
  };
  let errors = 0;
  if (
    !state.reposAt ||
    now.getTime() - Date.parse(state.reposAt) >= REPOS_REFRESH_MS
  ) {
    try {
      state.repos = parseRepos(await source.repos(account), account.owners);
      state.reposAt = at;
      // A repo that left scope takes its alerts with it, without events.
      const keep = new Set(state.repos);
      for (const [key, alert] of Object.entries(state.open))
        if (!keep.has(alert.repo)) delete state.open[key];
      for (const key of Object.keys(state.checked))
        if (!keep.has(key.slice(0, key.lastIndexOf("|"))))
          delete state.checked[key];
    } catch {
      errors++;
    }
  }

  let checks = 0;
  let dropped = 0;
  let lookups = 0;
  const pairs = pickChecks(
    state.repos,
    state.checked,
    now,
    ALERT_CHECKS_PER_POLL,
  );
  for (const { repo, type } of pairs) {
    const key = checkKey(repo, type);
    const last = state.checked[key];
    const before = Object.values(state.open).filter(
      (a) => a.repo === repo && a.alertType === type,
    );
    checks++;
    let fetched: AlertFetch;
    try {
      fetched = await source.alerts(account, repo, type);
    } catch {
      errors++;
      state.checked[key] = { at, ...(last?.read ? { read: true } : {}) };
      continue;
    }
    for (const alert of before) delete state.open[alertKey(alert)];
    if (fetched.denied) {
      state.checked[key] = { at, denied: true };
      continue;
    }
    dropped += fetched.dropped;
    const diff = diffAlerts(before, fetched.alerts, !last?.read, at);
    for (const alert of diff.next) state.open[alertKey(alert)] = alert;
    for (const alert of diff.opened) emit(alert, "opened");
    for (const alert of diff.gone) {
      // Past the lookup limit, or on an error, the alert waits for the next check.
      if (lookups >= ALERT_LOOKUPS_PER_POLL) {
        state.open[alertKey(alert)] = alert;
        continue;
      }
      lookups++;
      try {
        const found = await source.alert(account, repo, type, alert.number);
        const event = closedEvent(found);
        if (event) emit(alert, event);
        else if (found?.state === "OPEN") state.open[alertKey(alert)] = alert;
      } catch {
        errors++;
        state.open[alertKey(alert)] = alert;
      }
    }
    state.checked[key] = { at, read: true };
  }
  const denied = Object.values(state.checked).filter((c) => c.denied).length;
  return { checks, denied, dropped, errors, state };
}

/** The item a `released` event is built from. */
function shipped(entry: Shipping): Item {
  return {
    ci: null,
    closedAt: null,
    closes: [],
    id: "-",
    kind: "pr",
    mergeable: null,
    number: entry.number,
    repo: entry.repo,
    review: null,
    sha: entry.sha,
    state: "MERGED",
  };
}

/**
 * Compares each waiting PR's merge commit with its repo's latest release, and
 * calls `released` for each one the release contains. A release that was
 * already compared is not compared again. PRs older than SHIPPING_DAYS are
 * given up. A GitHub error leaves the rest for the next poll, so it never
 * fails the account's poll.
 */
async function checkReleases(
  account: Account,
  shipping: Record<string, Shipping>,
  source: Source,
  now: Date,
  released: (entry: Shipping) => void,
): Promise<void> {
  const oldest = now.getTime() - SHIPPING_DAYS * 86_400_000;
  for (const [id, entry] of Object.entries(shipping))
    if (Date.parse(entry.mergedAt) < oldest) delete shipping[id];
  const repos = [...new Set(Object.values(shipping).map((e) => e.repo))];
  if (repos.length === 0) return;
  try {
    const latest = await source.releases(account, repos);
    for (const [id, entry] of Object.entries(shipping)) {
      const tag = latest.get(entry.repo);
      if (!tag || tag === entry.checked) continue;
      if (await source.contains(account, entry.repo, entry.mergeSha, tag)) {
        released(entry);
        delete shipping[id];
      } else entry.checked = tag;
    }
  } catch {
    // Retried on the next poll.
  }
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
    for (const alert of Object.values(
      state.accounts[account.login]?.alerts?.open ?? {},
    )) {
      const key = alertKey(alert).toLowerCase();
      if (items.has(key)) continue;
      items.set(key, {
        account: account.login,
        alert_type: alert.alertType,
        ci: null,
        client: clientOf(account, alert.repo),
        closes: [],
        kind: "alert",
        mergeable: null,
        number: alert.number,
        package: alert.package,
        repo: alert.repo,
        review: null,
        severity: alert.severity,
        sha: null,
        since: alert.since ?? now.toISOString(),
        state: "OPEN",
        url: alertUrl(alert),
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
      (a, b) =>
        a.repo.localeCompare(b.repo) ||
        a.number - b.number ||
        a.kind.localeCompare(b.kind) ||
        (a.alert_type ?? "").localeCompare(b.alert_type ?? ""),
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
        alerts: result.alerts,
        items: result.items,
        polledAt: now.toISOString(),
        shipping: result.shipping,
      };
      reports.push({
        alertChecks: result.alertsReport.checks,
        alertErrors: result.alertsReport.errors,
        alerts: Object.keys(result.alerts.open).length,
        alertsDenied: result.alertsReport.denied,
        cost: result.cost,
        dropped: result.dropped,
        events: events.length,
        login: account.login,
        open: Object.keys(result.items).length,
        shipping: Object.keys(result.shipping).length,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : "unknown error";
      state.accounts[account.login] = {
        ...(prev?.alerts ? { alerts: prev.alerts } : {}),
        error,
        items: prev?.items ?? {},
        polledAt: prev?.polledAt ?? null,
        shipping: prev?.shipping ?? {},
      };
      reports.push({
        alertChecks: 0,
        alertErrors: 0,
        alerts: Object.keys(prev?.alerts?.open ?? {}).length,
        alertsDenied: 0,
        cost: 0,
        dropped: 0,
        error,
        events: 0,
        login: account.login,
        open: 0,
        shipping: Object.keys(prev?.shipping ?? {}).length,
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
  state.bridge = advance(
    state.bridge,
    config,
    Object.values(state.accounts).flatMap((a) => Object.values(a.items)),
    fresh,
  );
  writePrivate(files.state, JSON.stringify(state));
  writePrivate(
    files.registry,
    JSON.stringify(buildRegistry(config, state, now), null, 2) + "\n",
  );
  return reports;
}

/**
 * Syncs the tasks of every queued PR and saves what is still queued. Runs
 * after `runPoll`, in the same process, so the state file has one writer.
 */
export async function syncTasks(
  statePath: string,
  api: TasksApi,
): Promise<{ error?: string; moved: number; pending: number }> {
  const state = loadState(statePath);
  if (!state.bridge?.pending.length) return { moved: 0, pending: 0 };
  const result = await sync(state.bridge, api);
  state.bridge.pending = result.pending;
  writePrivate(statePath, JSON.stringify(state));
  return {
    error: result.error,
    moved: result.moved,
    pending: result.pending.length,
  };
}
