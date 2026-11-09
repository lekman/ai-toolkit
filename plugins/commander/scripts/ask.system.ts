/**
 * ask.system — the I/O behind the ask and delivery hooks: configuration
 * files, session records, the tasks trace, tokens, the inbox state files,
 * and the JSON-RPC calls to Atlas and the tasks server. The rules live in
 * `ask-logic.ts`.
 *
 * Environment, all optional:
 * - CLAUDE_CONFIG_DIR: the account's configuration folder (default ~/.claude).
 * - ATLAS_MCP_URL, ATLAS_TOKEN: Atlas's MCP address and machine token. The
 *   address can also come from `ask.json` (`atlasUrl`) or the `env` block
 *   of settings.json, and the token from the Keychain item `atlas-token`.
 *   An address on localhost needs no token.
 * - TASKS_MCP_URL, TASKS_MCP_TOKEN: the tasks server, as the `tasks` command
 *   reads them (settings.json `env`, Keychain item `tasks-mcp-token`).
 * - ASK_STATE_DIR, ASK_OBSIDIAN_FILE, TASKS_TRACE_DIR: file locations, for tests.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

import {
  accountOf,
  addressesOf,
  type AskConfig,
  type AskContext,
  clientOf,
  type InboxMessage,
  type ObsidianClients,
  type SessionRecord,
} from "./ask-logic.ts";

/** An MCP endpoint over HTTP: its address and its bearer token, if any. */
export interface Endpoint {
  token: null | string;
  url: string;
}

const home = homedir();

/** The machine's short name. */
export function shortHost(): string {
  return hostname().split(".")[0] ?? "unknown";
}

/** The account's configuration folder: CLAUDE_CONFIG_DIR, or ~/.claude. */
export function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, ".claude");
}

/** A JSON file's content, or null when it is missing or not JSON. */
export function readJson<T>(path: string): null | T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** The ask configuration: the account folder's `ask.json`, else `~/.claude/ask.json`. */
export function askConfig(): AskConfig {
  return (
    readJson<AskConfig>(join(configDir(), "ask.json")) ??
    readJson<AskConfig>(join(home, ".claude", "ask.json")) ??
    {}
  );
}

/** The dashboard's client folders, from `~/.claude/obsidian.json`. */
export function obsidianClients(): ObsidianClients {
  return (
    readJson<ObsidianClients>(
      process.env.ASK_OBSIDIAN_FILE ?? join(home, ".claude", "obsidian.json"),
    ) ?? {}
  );
}

/** The session folders to read: the account's own first, then ~/.claude's. */
function sessionDirs(): string[] {
  const own = join(configDir(), "sessions");
  const shared = join(home, ".claude", "sessions");
  return own === shared ? [own] : [own, shared];
}

/** A session's record by its id, from the account's session folder. */
export function sessionRecord(sessionId: string): null | SessionRecord {
  if (!sessionId) return null;
  for (const dir of sessionDirs()) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const record = readJson<SessionRecord>(join(dir, file));
      if (record?.sessionId === sessionId) return record;
    }
  }
  return null;
}

/** Whether a session still runs: its record exists and its process answers. */
export function sessionAlive(sessionId: string): boolean {
  const record = sessionRecord(sessionId);
  if (!record) return false;
  if (typeof record.pid !== "number") return true;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The session name a claude command line gives with `--remote-control` or
 * `--name`. The name runs to the next ` --` flag or the end, because ps
 * joins arguments with spaces ("--remote-control Ops Portal").
 */
export function nameFromArgs(args: string): null | string {
  const m = /(?:^|\s)--(?:remote-control|name)\s+(.+?)(?=\s--|$)/.exec(args);
  const name = m?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  return name || null;
}

/** The name from the nearest claude process above this hook, up to eight levels. */
export function nameFromProcess(start = process.ppid): null | string {
  if (process.env.NO_ASK_SKIP_PROCESS) return null;
  let pid = start;
  for (let i = 0; i < 8 && pid > 1; i++) {
    const r = spawnSync("ps", ["-o", "ppid=,args=", "-p", String(pid)], {
      encoding: "utf8",
    });
    const m = /^(\d+)\s+(.*)$/.exec((r.stdout ?? "").trim());
    if (!m) return null;
    // Only the claude program itself, not a shell whose command mentions it.
    if (/^(\S*\/)?claude(\s|$)/.test(m[2]!)) {
      const name = nameFromArgs(m[2]!);
      if (name) return name;
    }
    pid = Number(m[1]);
  }
  return null;
}

/** The task this session claimed or added last, from the tasks plugin's trace file. */
export function latestTask(sessionId: string): null | string {
  if (!/^[\w-]+$/.test(sessionId)) return null;
  const dir =
    process.env.TASKS_TRACE_DIR ?? join(home, ".claude", "tasks-trace");
  const doc = readJson<{ tasks?: unknown }>(join(dir, `${sessionId}.json`));
  const tasks = Array.isArray(doc?.tasks)
    ? doc.tasks.filter((t): t is string => typeof t === "string")
    : [];
  return tasks.at(-1) ?? null;
}

/** A variable from the `env` block of settings.json, in the account folder or ~/.claude. */
function settingsEnv(name: string): string | undefined {
  for (const dir of [configDir(), join(home, ".claude")]) {
    const value = readJson<{ env?: Record<string, unknown> }>(
      join(dir, "settings.json"),
    )?.env?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** A Keychain password by service name, or null. Never printed. */
function keychain(service: string): null | string {
  if (process.platform !== "darwin") return null;
  const r = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", service, "-w"],
    { encoding: "utf8", timeout: 5000 },
  );
  return r.status === 0 ? r.stdout.trim() || null : null;
}

function isLoopback(url: string): boolean {
  try {
    return ["127.0.0.1", "[::1]", "localhost"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Atlas's MCP endpoint, or null when no address is configured. */
export function atlasEndpoint(config: AskConfig): Endpoint | null {
  const url =
    process.env.ATLAS_MCP_URL?.trim() ||
    settingsEnv("ATLAS_MCP_URL") ||
    config.atlasUrl;
  if (!url || !/^https?:\/\//.test(url)) return null;
  const token =
    process.env.ATLAS_TOKEN?.trim() ||
    (isLoopback(url) ? null : keychain("atlas-token"));
  return { token, url };
}

/** The tasks server's MCP endpoint, or null when no address or token is configured. */
export function tasksEndpoint(): Endpoint | null {
  const url = process.env.TASKS_MCP_URL?.trim() || settingsEnv("TASKS_MCP_URL");
  if (!url || !/^https?:\/\//.test(url)) return null;
  const token =
    process.env.TASKS_MCP_TOKEN?.trim() || keychain("tasks-mcp-token");
  return token ? { token, url } : null;
}

/**
 * One MCP tool call over HTTP, answered as JSON or as one server-sent
 * event. Returns the tool's JSON answer. Throws with a short reason, never
 * with the token, when the server cannot be reached, refuses, or times out.
 */
export async function callTool(
  endpoint: Endpoint,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 4000,
): Promise<unknown> {
  const response = await fetch(endpoint.url, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name: tool },
    }),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {}),
    },
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.text();
  const data = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .at(-1);
  const message = JSON.parse(data ?? raw) as {
    error?: { message?: string };
    result?: { content?: { text?: string }[]; isError?: boolean };
  };
  if (message.error) throw new Error(message.error.message ?? "refused");
  const text = message.result?.content?.[0]?.text ?? "";
  if (message.result?.isError) throw new Refused(text.slice(0, 300));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A tool call the server answered with a refusal; its text is the server's reason. */
export class Refused extends Error {}

/** Messages to any of `addresses` that no one has marked delivered, oldest first. */
export async function readInbox(
  endpoint: Endpoint,
  addresses: readonly string[],
  timeoutMs = 4000,
): Promise<InboxMessage[]> {
  const out: InboxMessage[] = [];
  for (const to of addresses) {
    const answer = await callTool(
      endpoint,
      "message_inbox",
      { limit: 50, to, undelivered: true },
      timeoutMs,
    );
    // The tasks server answers `{ messages: [...] }`.
    const messages = (answer as null | { messages?: unknown })?.messages;
    if (Array.isArray(messages))
      for (const m of messages)
        if (typeof m?.id === "string" && typeof m?.text === "string")
          out.push(m as InboxMessage);
  }
  return out;
}

/** Where the inbox state lives: the ids shown to each session, and each session's watcher. */
export function stateDir(): string {
  return process.env.ASK_STATE_DIR ?? join(configDir(), "commander", "inbox");
}

function safeId(sessionId: string): string {
  return sessionId.replace(/[^\w-]/g, "_");
}

/** The message ids already shown to a session. */
export function readSeen(sessionId: string): Set<string> {
  const ids = readJson<string[]>(
    join(stateDir(), `${safeId(sessionId)}.seen.json`),
  );
  return new Set(Array.isArray(ids) ? ids : []);
}

/** Adds ids to a session's shown list, keeping the newest 500. */
export function addSeen(sessionId: string, ids: readonly string[]): void {
  const all = [...readSeen(sessionId), ...ids].slice(-500);
  writeAtomic(
    join(stateDir(), `${safeId(sessionId)}.seen.json`),
    JSON.stringify(all),
  );
}

/** The pid of a session's current watcher, or null. */
export function watchOwner(sessionId: string): null | number {
  try {
    const pid = Number(
      readFileSync(join(stateDir(), `${safeId(sessionId)}.watch`), "utf8"),
    );
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Makes `pid` the session's watcher; an older watcher sees this and stops. */
export function claimWatch(sessionId: string, pid: number): void {
  writeAtomic(join(stateDir(), `${safeId(sessionId)}.watch`), String(pid));
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(stateDir(), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}

/** The hook's standard input as JSON, or null when it is not JSON. */
export async function hookInput(): Promise<null | Record<string, unknown>> {
  try {
    return JSON.parse(await Bun.stdin.text()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The session this process runs under: the nearest parent whose pid has a session record. */
export function sessionFromProcess(start = process.ppid): null | SessionRecord {
  let pid = start;
  for (let i = 0; i < 10 && pid > 1; i++) {
    for (const dir of sessionDirs()) {
      const record = readJson<SessionRecord>(join(dir, `${pid}.json`));
      if (record?.sessionId) return record;
    }
    const r = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
      encoding: "utf8",
    });
    const parent = Number((r.stdout ?? "").trim());
    if (!Number.isInteger(parent) || parent <= 1) return null;
    pid = parent;
  }
  return null;
}

/** Everything the hooks and the skill need to know about a session. */
export function sessionContext(
  sessionId: string,
  cwd: string,
  record: null | SessionRecord = sessionRecord(sessionId),
): AskContext {
  const config = askConfig();
  const named = record?.name && record.nameSource !== "auto";
  return {
    account: accountOf(process.env.CLAUDE_CONFIG_DIR, home),
    addresses: addressesOf(sessionId, record, named ? null : nameFromProcess()),
    clientId: clientOf(cwd, config, obsidianClients()),
    config,
    host: shortHost(),
    sessionId,
    taskId: latestTask(sessionId),
  };
}
