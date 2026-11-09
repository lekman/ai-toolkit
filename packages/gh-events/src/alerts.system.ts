/**
 * GitHub's REST API for Dependabot, code scanning and secret scanning
 * alerts. Thin wrappers: the guard in alerts.ts reads every response.
 */
import {
  type Alert,
  type AlertFetch,
  type AlertType,
  parseAlert,
} from "./alerts";

const API = "https://api.github.com";
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
/** 100 per page, at most 10 pages: 1,000 open alerts per repo and type. */
const PER_PAGE = 100;
const MAX_PAGES = 10;

const PATHS: Record<AlertType, string> = {
  code_scanning: "code-scanning",
  dependabot: "dependabot",
  secret_scanning: "secret-scanning",
};

// hide_secret keeps the secret itself out of the response.
const extra = (type: AlertType): Record<string, string> =>
  type === "secret_scanning" ? { hide_secret: "true" } : {};

/** A query string from parameters, "" when there are none. */
function query(params: Record<string, string>): string {
  const text = new URLSearchParams(params).toString();
  return text ? `?${text}` : "";
}

async function get(auth: string, url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `bearer ${auth}`,
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20_000),
  });
}

/**
 * True for a 403 or 404 that means the feature is off or the token cannot
 * see it. A rate limit also answers 403 or 429, and is an error instead.
 */
function refused(res: Response): boolean {
  if (res.status !== 403 && res.status !== 404) return false;
  return (
    res.headers.get("x-ratelimit-remaining") !== "0" &&
    !res.headers.has("retry-after")
  );
}

/** The `rel="next"` URL of a Link header, only when it stays on the API host. */
function nextPage(res: Response): null | string {
  const match = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "");
  const url = match?.[1];
  return url?.startsWith(`${API}/`) ? url : null;
}

/** The open alerts of one type in one repo. */
export async function fetchAlerts(
  auth: string,
  repo: string,
  type: AlertType,
): Promise<AlertFetch> {
  if (!REPO.test(repo)) throw new Error("alerts: invalid repo");
  const alerts: Alert[] = [];
  let dropped = 0;
  let url: null | string =
    `${API}/repos/${repo}/${PATHS[type]}/alerts${query({ state: "open", per_page: String(PER_PAGE), ...extra(type) })}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await get(auth, url);
    if (refused(res)) return { denied: true };
    // Status only: the body is untrusted and stays out of the log.
    if (!res.ok) throw new Error(`GitHub alerts HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) throw new Error("GitHub alerts: not a list");
    for (const raw of body) {
      const alert = parseAlert(raw, type, repo);
      if (alert?.state === "OPEN") alerts.push(alert);
      else dropped++;
    }
    url = nextPage(res);
  }
  return { alerts, denied: false, dropped };
}

/** One alert by number, or null when it cannot be read or fails the guard. */
export async function fetchAlert(
  auth: string,
  repo: string,
  type: AlertType,
  number: number,
): Promise<Alert | null> {
  if (!REPO.test(repo) || !Number.isInteger(number))
    throw new Error("alert: invalid repo or number");
  const res = await get(
    auth,
    `${API}/repos/${repo}/${PATHS[type]}/alerts/${number}${query(extra(type))}`,
  );
  if (refused(res)) return null;
  if (!res.ok) throw new Error(`GitHub alert HTTP ${res.status}`);
  return parseAlert(await res.json(), type, repo);
}
