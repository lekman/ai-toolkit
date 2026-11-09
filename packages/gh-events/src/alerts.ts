/**
 * Dependabot, code scanning and secret scanning alerts. The guard part keeps
 * an alert's number, state, severity and, for Dependabot, the package name.
 * Advisory text, rule descriptions, file paths, messages and secrets are
 * never read. The rest is the pure logic the poller runs per repo and alert
 * type: which pairs to check this poll, and what changed since the last check.
 */
import type { Owner } from "./config";
import type { GhEvent } from "./diff";

import { watched } from "./guard";

/** The three alert sources GitHub has, as they appear in the contract. */
export type AlertType = "code_scanning" | "dependabot" | "secret_scanning";

/** The order pairs are checked in when they tie. */
export const ALERT_TYPES: readonly AlertType[] = [
  "dependabot",
  "code_scanning",
  "secret_scanning",
];

export type Severity = "critical" | "high" | "low" | "medium";

/** Only `OPEN` reaches the registry; the others come from a lookup. */
export type AlertStatus = "DISMISSED" | "FIXED" | "OPEN";

export type AlertEventName = "dismissed" | "fixed" | "opened";

/** One alert, reduced to the fields the poller compares and writes. */
export interface Alert {
  alertType: AlertType;
  number: number;
  /** Dependabot only: the package name, when it matched the pattern. */
  package: null | string;
  repo: string;
  severity: null | Severity;
  /** When the poller first saw the alert. Set by the poller. */
  since?: string;
  state: AlertStatus;
}

/** What one list call returned. `denied` is a 403 or 404 from GitHub. */
export type AlertFetch =
  { alerts: Alert[]; denied: false; dropped: number } | { denied: true };

/** The last check of one repo and alert type. */
export interface AlertCheck {
  at: string;
  /** GitHub refused the list: the feature is off or the token has no access. */
  denied?: true;
  /** A list has been read since the pair was first seen or last refused. */
  read?: true;
}

/** What the poller remembers about one account's alerts. */
export interface AlertsState {
  /** By `checkKey`. */
  checked: Record<string, AlertCheck>;
  /** Open alerts by `alertKey`. */
  open: Record<string, Alert>;
  /** Watched repos, from the last refresh of the repo list. */
  repos: string[];
  /** When the repo list was last refreshed, or null before the first time. */
  reposAt: null | string;
}

const REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
/**
 * Package names across ecosystems: npm `@scope/name`, Maven `group:artifact`,
 * Go `host/path`, PyPI, NuGet, RubyGems, Cargo, Composer. No spaces, quotes
 * or shell characters.
 */
const PACKAGE = /^[A-Za-z0-9@][A-Za-z0-9@/._:+-]{0,213}$/;
const SEVERITIES: readonly Severity[] = ["critical", "high", "low", "medium"];

/** How long a pair GitHub refused waits before it is tried again. */
export const DENIED_RETRY_MS = 86_400_000;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const severity = (value: unknown): null | Severity =>
  SEVERITIES.find((s) => s === value) ?? null;

/** The GitHub state of an alert, mapped onto open, fixed or dismissed. */
function status(
  node: Record<string, unknown>,
  type: AlertType,
): AlertStatus | undefined {
  const state = node.state;
  if (state === "open") return "OPEN";
  if (type === "secret_scanning")
    // A revoked secret is fixed; any other resolution is a decision to leave it.
    return state === "resolved"
      ? node.resolution === "revoked"
        ? "FIXED"
        : "DISMISSED"
      : undefined;
  if (state === "fixed") return "FIXED";
  if (state === "dismissed" || state === "auto_dismissed") return "DISMISSED";
  return undefined;
}

/**
 * Validates one alert from GitHub's REST API. `repo` is the validated repo
 * the request named, since a repo-level alert does not carry it. Returns null
 * when the number or state is out of shape. A severity or package name out
 * of shape becomes null, so the alert is still reported.
 */
export function parseAlert(
  raw: unknown,
  type: AlertType,
  repo: string,
): Alert | null {
  const node = record(raw);
  if (!node || !REPO.test(repo)) return null;
  const number = node.number;
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > 1e8
  )
    return null;
  const state = status(node, type);
  if (!state) return null;

  let level: null | Severity = null;
  let name: null | string = null;
  if (type === "dependabot") {
    level =
      severity(record(node.security_vulnerability)?.severity) ??
      severity(record(node.security_advisory)?.severity);
    const pkg = record(record(node.dependency)?.package)?.name;
    name = typeof pkg === "string" && PACKAGE.test(pkg) ? pkg : null;
  } else if (type === "code_scanning") {
    level = severity(record(node.rule)?.security_severity_level);
  }
  return {
    alertType: type,
    number,
    package: name,
    repo,
    severity: level,
    state,
  };
}

/**
 * Repo names from a GraphQL repository list: well formed, watched, sorted
 * and without repeats.
 */
export function parseRepos(raw: unknown[], owners: readonly Owner[]): string[] {
  const repos = new Set<string>();
  for (const node of raw) {
    const name = record(node)?.nameWithOwner;
    if (typeof name === "string" && REPO.test(name) && watched(name, owners))
      repos.add(name);
  }
  return [...repos].sort();
}

/** `repo#alert-type-number`: an alert's id in state and in event keys. */
export const alertKey = (a: Pick<Alert, "alertType" | "number" | "repo">) =>
  `${a.repo}#alert-${a.alertType}-${a.number}`;

/** `repo|type`: one pair the poller checks. */
export const checkKey = (repo: string, type: AlertType): string =>
  `${repo}|${type}`;

const PAGES: Record<AlertType, string> = {
  code_scanning: "code-scanning",
  dependabot: "dependabot",
  secret_scanning: "secret-scanning",
};

/** The alert's page on GitHub, built from validated fields only. */
export const alertUrl = (
  a: Pick<Alert, "alertType" | "number" | "repo">,
): string =>
  `https://github.com/${a.repo}/security/${PAGES[a.alertType]}/${a.number}`;

/**
 * The pairs to check this poll: those never checked first, then the least
 * recently checked, up to `limit`. A pair GitHub refused waits
 * DENIED_RETRY_MS before it is tried again.
 */
export function pickChecks(
  repos: readonly string[],
  checked: Readonly<Record<string, AlertCheck>>,
  now: Date,
  limit: number,
): { repo: string; type: AlertType }[] {
  const pairs: { at: number; repo: string; type: AlertType }[] = [];
  for (const repo of repos)
    for (const type of ALERT_TYPES) {
      const last = checked[checkKey(repo, type)];
      const at = last ? Date.parse(last.at) : -Infinity;
      if (last?.denied && now.getTime() - at < DENIED_RETRY_MS) continue;
      pairs.push({ at, repo, type });
    }
  // Array sort is stable, so ties keep repo order, then ALERT_TYPES order.
  return pairs
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map(({ repo, type }) => ({ repo, type }));
}

/**
 * Compares the open alerts of one repo and type with the last check. A
 * baseline (the pair was never read before) stores without events. An alert
 * that is no longer open is `gone`, and the poller looks it up to learn why.
 */
export function diffAlerts(
  prev: readonly Alert[],
  fetched: readonly Alert[],
  baseline: boolean,
  now: string,
): { gone: Alert[]; next: Alert[]; opened: Alert[] } {
  const before = new Map(prev.map((a) => [alertKey(a), a]));
  const seen = new Set<string>();
  const next: Alert[] = [];
  const opened: Alert[] = [];
  for (const alert of fetched) {
    const key = alertKey(alert);
    seen.add(key);
    const known = before.get(key);
    next.push({ ...alert, since: known?.since ?? now });
    if (!known && !baseline) opened.push(alert);
  }
  const gone = prev.filter((a) => !seen.has(alertKey(a)));
  return { gone, next, opened };
}

/** The event for an alert that left the open list, from its lookup. */
export function closedEvent(lookup: Alert | null): AlertEventName | null {
  if (lookup?.state === "FIXED") return "fixed";
  if (lookup?.state === "DISMISSED") return "dismissed";
  return null;
}

/** Builds the log line for one alert event. */
export function alertEvent(
  account: string,
  client: null | string,
  alert: Alert,
  event: AlertEventName,
  at: Date,
): GhEvent {
  return {
    account,
    alert_type: alert.alertType,
    at: at.toISOString(),
    client,
    event,
    key: `${alertKey(alert)}:${event}`,
    kind: "alert",
    number: alert.number,
    package: alert.package,
    repo: alert.repo,
    severity: alert.severity,
    sha: null,
    v: 1,
  };
}
