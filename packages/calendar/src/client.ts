/**
 * Shared Microsoft Graph client: config, token cache with refresh, fetch.
 *
 * Config:  ~/.claude/calendar.json        { tenant, clientId, calendars }
 * Tokens:  ~/.claude/calendar-token.json  (0600; refresh token rotates on use)
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_PATH = join(homedir(), ".claude", "calendar.json");
export const TOKEN_PATH = join(homedir(), ".claude", "calendar-token.json");
export const SCOPE =
  "https://graph.microsoft.com/Calendars.Read offline_access openid profile";

export interface CalendarConfig {
  name: string;
  kind: "meetings" | "admin";
}

export interface Config {
  tenant: string;
  clientId: string;
  timezone?: string;
  calendars: CalendarConfig[];
}

export interface TokenCache {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

/** Raised for any auth/config failure the caller should surface loudly. */
export class AuthError extends Error {}

/** Parse a JSON file. */
export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Write JSON with owner-only permissions (0600). */
export function writePrivate(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
  chmodSync(path, 0o600);
}

/** Load ~/.claude/calendar.json or fail with setup instructions. */
export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new AuthError(
      `No config at ${CONFIG_PATH} — run scripts/setup-entra.sh first.`,
    );
  }
  return readJson<Config>(CONFIG_PATH);
}

/** OAuth token endpoint for a tenant. */
export function tokenUrl(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

/** Return a valid access token, refreshing (and re-caching) if expired. */
export async function accessToken(): Promise<string> {
  const { tenant, clientId } = loadConfig();
  if (!existsSync(TOKEN_PATH)) {
    throw new AuthError(
      "Not signed in — run `bun src/auth.ts start`, then `finish`.",
    );
  }
  const cache = readJson<TokenCache>(TOKEN_PATH);
  if (Date.now() < cache.expires_at - 60_000) return cache.access_token;

  const res = await fetch(tokenUrl(tenant), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: cache.refresh_token,
      scope: SCOPE,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new AuthError(
      `Token refresh failed: ${data.error} — sign in again with \`start\` + \`finish\`.`,
    );
  }
  writePrivate(TOKEN_PATH, {
    access_token: data.access_token as string,
    refresh_token: (data.refresh_token as string) ?? cache.refresh_token,
    expires_at: Date.now() + (data.expires_in as number) * 1000,
  } satisfies TokenCache);
  return data.access_token as string;
}

/** GET a Graph v1.0 path. Bodies come back as plain text, times in `timezone`. */
export async function graph<T>(
  path: string,
  timezone = "Europe/London",
): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: `outlook.timezone="${timezone}", outlook.body-content-type="text"`,
    },
  });
  if (!res.ok) {
    throw new AuthError(
      `Graph ${path} failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}
