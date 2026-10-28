import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A GitHub org or user whose PRs and issues are searched, with repo filters. */
export interface Owner {
  /** The consumer's client id for this owner's repos, or null. See CONTRACT.md. */
  client: null | string;
  /** Repo name globs to skip, applied after `include`. */
  exclude: string[];
  /** Repo name globs to watch. `*` is the only wildcard. */
  include: string[];
  /** `org` or `user`; picks the search qualifier. */
  kind: "org" | "user";
  name: string;
  /** Client ids for single repos, by lowercase repo name. Wins over `client`. */
  repos: Record<string, null | string>;
  /**
   * Repo name globs that never publish a release. A merge there finishes the
   * work, so it is not watched for a release.
   */
  unreleased: string[];
}

/** One GitHub account, read through its own `gh` token. */
export interface Account {
  /** Login as `gh auth status` lists it. */
  login: string;
  owners: Owner[];
}

/** Parsed `config.json`. */
export interface Config {
  accounts: Account[];
  /** Seconds between polls, written into the launchd plist. */
  intervalSeconds: number;
}

const LOGIN = /^[A-Za-z0-9_-]{1,64}$/;
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const GLOB = /^[A-Za-z0-9._*-]{1,100}$/;
const CLIENT = /^[A-Za-z0-9._-]{1,64}$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;

const configHome = (): string =>
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
const stateHome = (): string =>
  process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");

/** Where the config, state, registry and event log live. */
export const paths = {
  config: (): string => join(configHome(), "gh-events", "config.json"),
  events: (): string => join(stateHome(), "gh-events", "events.jsonl"),
  registry: (): string => join(stateHome(), "gh-events", "registry.json"),
  state: (): string => join(stateHome(), "gh-events", "state.json"),
  stateDir: (): string => join(stateHome(), "gh-events"),
};

function fail(message: string): never {
  throw new Error(`config: ${message}`);
}

const clientId = (value: unknown, field: string): null | string =>
  value === null || (typeof value === "string" && CLIENT.test(value))
    ? value
    : fail(`${field} is invalid`);

function repoClients(
  value: unknown,
  field: string,
): Record<string, null | string> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${field} must be an object`);
  const repos: Record<string, null | string> = {};
  for (const [name, client] of Object.entries(value)) {
    if (!REPO_NAME.test(name)) fail(`${field} has an invalid repo name`);
    repos[name.toLowerCase()] = clientId(client, `${field}.${name}`);
  }
  return repos;
}

function globs(value: unknown, field: string, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value.map((item) =>
    typeof item === "string" && GLOB.test(item)
      ? item
      : fail(`${field} has an invalid pattern`),
  );
}

/** Validates a parsed config object. Throws on the first problem. */
export function parseConfig(raw: unknown): Config {
  const root = raw as { accounts?: unknown; intervalSeconds?: unknown };
  if (typeof root !== "object" || root === null) fail("not an object");

  const interval = root.intervalSeconds ?? 60;
  if (
    typeof interval !== "number" ||
    !Number.isInteger(interval) ||
    interval < 30
  )
    fail("intervalSeconds must be an integer of at least 30");

  if (!Array.isArray(root.accounts) || root.accounts.length === 0)
    fail("accounts must be a non-empty array");

  const accounts = root.accounts.map(
    (a: { login?: unknown; owners?: unknown }, i) => {
      if (typeof a?.login !== "string" || !LOGIN.test(a.login))
        fail(`accounts[${i}].login is invalid`);
      if (!Array.isArray(a.owners) || a.owners.length === 0)
        fail(`accounts[${i}].owners must be a non-empty array`);
      const owners = a.owners.map(
        (
          o: {
            client?: unknown;
            exclude?: unknown;
            include?: unknown;
            kind?: unknown;
            name?: unknown;
            repos?: unknown;
            unreleased?: unknown;
          },
          j,
        ) => {
          const at = `accounts[${i}].owners[${j}]`;
          if (typeof o?.name !== "string" || !OWNER.test(o.name))
            fail(`${at}.name is invalid`);
          const kind = o.kind ?? "org";
          if (kind !== "org" && kind !== "user")
            fail(`${at}.kind must be org or user`);
          return {
            client: clientId(o.client ?? null, `${at}.client`),
            exclude: globs(o.exclude, `${at}.exclude`, []),
            include: globs(o.include, `${at}.include`, ["*"]),
            kind,
            name: o.name,
            repos: repoClients(o.repos, `${at}.repos`),
            unreleased: globs(o.unreleased, `${at}.unreleased`, []),
          } satisfies Owner;
        },
      );
      return { login: a.login, owners } satisfies Account;
    },
  );

  return { accounts, intervalSeconds: interval };
}

/** Reads and validates the config file. */
export function loadConfig(path = paths.config()): Config {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}
