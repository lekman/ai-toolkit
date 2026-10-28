/**
 * A small client for the tasks MCP server (packages/tasks-mcp), used by the
 * bridge. It finds the server the same way the `tasks` command does: the
 * address from TASKS_MCP_URL or the env block of ~/.claude/settings.json, the
 * token from TASKS_MCP_TOKEN or the login Keychain (service tasks-mcp-token).
 * The token is never logged.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { TasksApi, TaskState, TaskSummary } from "./bridge";

/** The name the bridge's changes are recorded under. */
export const BY = "gh-events";

const KEYCHAIN_SERVICE = "tasks-mcp-token";

function serverUrl(): null | string {
  let url = process.env.TASKS_MCP_URL ?? "";
  if (!url) {
    try {
      const settings = JSON.parse(
        readFileSync(join(homedir(), ".claude", "settings.json"), "utf8"),
      ) as { env?: Record<string, string> };
      url = settings.env?.TASKS_MCP_URL ?? "";
    } catch {
      url = "";
    }
  }
  return /^https?:\/\//.test(url) ? url : null;
}

function serverToken(): null | string {
  const fromEnv = process.env.TASKS_MCP_TOKEN;
  if (fromEnv) return fromEnv;
  const out = Bun.spawnSync(
    [
      "/usr/bin/security",
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ],
    { stderr: "ignore" },
  );
  const value = out.stdout.toString().trim();
  return out.exitCode === 0 && value ? value : null;
}

async function call(
  url: string,
  auth: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(url, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name: tool },
    }),
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${auth}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`tasks server HTTP ${res.status}`);
  const raw = await res.text();
  // The server answers as JSON or as one server-sent event.
  const data = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .at(-1);
  const message = JSON.parse(data ?? raw) as {
    error?: { message?: string };
    result?: { content?: { text?: string }[]; isError?: boolean };
  };
  if (message.error) throw new Error(`${tool}: server error`);
  const text = message.result?.content?.[0]?.text ?? "";
  // A refusal's text is the server's own message, safe to log.
  if (message.result?.isError)
    throw new Error(`${tool}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as unknown;
}

/** The task database, or null when no server address or token is set. */
export function tasksApi(): null | TasksApi {
  const url = serverUrl();
  const auth = url ? serverToken() : null;
  if (!url || !auth) return null;
  return {
    search: async (pr) => {
      const result = (await call(url, auth, "task_search", {
        limit: 50,
        pullRequest: pr,
      })) as { items?: TaskSummary[] };
      return result.items ?? [];
    },
    update: async (id, revision, state: TaskState, note) => {
      await call(url, auth, "task_update", {
        by: BY,
        force: true,
        id,
        note,
        revision,
        state,
      });
    },
  };
}
