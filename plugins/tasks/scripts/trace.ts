#!/usr/bin/env bun
/**
 * trace — hooks that tie every piece of agent work to a task in the task
 * database, so "what was done here" is answered from the task's log, its
 * pull requests and its Details page.
 *
 * PostToolUse: when a session claims or adds a task, through the tasks MCP
 * tools or the `tasks` command, the task's id is recorded against the
 * session id in TASKS_TRACE_DIR (default ~/.claude/tasks-trace).
 *
 * PreToolUse, gates that refuse the call and say how to fix it:
 * - `git commit` and `git push` need a task recorded for this session.
 * - `gh pr create` also needs one of those tasks to have a Details page, its
 *   `detailsId`. Work with pull requests is completed by gh-events when it
 *   ships, not by the agent, so opening the pull request is the last point
 *   the agent still holds the task.
 * - Completing a task (`task_complete`, `tasks done`, `tasks state ID done`)
 *   needs that task to have a Details page.
 * One sentence on the page is enough when there is little to say.
 *
 * Every gate fails open. An unreadable input, or a task database that does
 * not answer, lets the call through: a guard that stops all work when the
 * database is down is worse than the gap it closes.
 *
 * Environment: TASKS_TRACE_DIR, and TASKS_CLI (default: the `tasks` script
 * beside this file), for tests.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOOL = "mcp__plugin_tasks_tasks__";
const ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A shell command as its simple commands, each a list of words. Splitting on
 * separators and then on whitespace never backtracks, which matters for a
 * hook that runs on every command an agent types.
 */
function simpleCommands(command: string): string[][] {
  return command
    .split(/[;&|()\n]/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0);
}

/** The words after a program, from each simple command that runs it. */
function argsOf(command: string, program: string): string[][] {
  const out: string[][] = [];
  for (const words of simpleCommands(command)) {
    const at = words.findIndex(
      (w) => w === program || w.endsWith(`/${program}`),
    );
    if (at >= 0) out.push(words.slice(at + 1));
  }
  return out;
}

/** The first word that is not a global option, skipping the values `withValue` options take. */
function subcommand(
  args: string[],
  withValue: ReadonlySet<string>,
): number | null {
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    if (!w.startsWith("-")) return i;
    if (withValue.has(w)) i++;
  }
  return null;
}

/** git's global options that take their value as the next word. */
const GIT_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
]);
/** gh's global options that take their value as the next word. */
const GH_VALUE = new Set(["-R", "--repo", "--hostname"]);

/**
 * What a shell command ships: `pr` when it opens a pull request, `commit`
 * when it commits or pushes, null when it does neither.
 */
export function ships(command: string): "commit" | "pr" | null {
  for (const args of argsOf(command, "gh")) {
    const at = subcommand(args, GH_VALUE);
    if (at !== null && args[at] === "pr" && args[at + 1] === "create")
      return "pr";
  }
  for (const args of argsOf(command, "git")) {
    const at = subcommand(args, GIT_VALUE);
    if (at !== null && (args[at] === "commit" || args[at] === "push"))
      return "commit";
  }
  return null;
}

/** The `tasks` command's subcommand and its arguments, if the command runs it. */
function tasksArgs(command: string): string[] | null {
  const runs = argsOf(command, "tasks");
  if (!runs.length) return null;
  const words = runs[0]!;
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === "--by") i++;
    else if (!w.startsWith("--")) out.push(w);
  }
  return out;
}

/** The id of the task a call completes, or null when it completes none. */
export function completes(
  tool: string,
  input: Record<string, unknown>,
): string | null {
  if (tool === `${TOOL}task_complete`) {
    return typeof input.id === "string" && ID.test(input.id) ? input.id : null;
  }
  if (tool !== "Bash" || typeof input.command !== "string") return null;
  const a = tasksArgs(input.command);
  if (!a) return null;
  if (a[0] === "done" && a[1] && ID.test(a[1])) return a[1];
  if (a[0] === "state" && a[2] === "done" && a[1] && ID.test(a[1])) return a[1];
  return null;
}

/** The text a tool answered with, whatever shape the answer came in. */
function answerText(response: unknown): string {
  if (typeof response === "string") return response;
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>;
    if (typeof r.stdout === "string") return r.stdout;
    if (Array.isArray(r.content)) return answerText(r.content);
  }
  if (Array.isArray(response)) {
    return response
      .map((b) =>
        b && typeof b === "object" && typeof b.text === "string" ? b.text : "",
      )
      .join("\n");
  }
  return JSON.stringify(response ?? "");
}

/** The ids of the tasks a call claimed or added. */
export function taskIdsFrom(
  tool: string,
  input: Record<string, unknown>,
  response: unknown,
): string[] {
  if (tool === `${TOOL}task_claim`) {
    return typeof input.id === "string" && ID.test(input.id) ? [input.id] : [];
  }
  const text = answerText(response);
  if (tool === `${TOOL}task_add`) {
    const m = /"id"\s*:\s*"([a-z0-9][a-z0-9-]*)"/.exec(text);
    return m ? [m[1]!] : [];
  }
  if (tool !== "Bash" || typeof input.command !== "string") return [];
  const a = tasksArgs(input.command);
  if (!a || (a[0] !== "claim" && a[0] !== "add")) return [];
  const m =
    /\b(?:claimed|added)\s+([a-z0-9][a-z0-9-]*)/.exec(text) ??
    /"id"\s*:\s*"([a-z0-9][a-z0-9-]*)"/.exec(text);
  return m ? [m[1]!] : [];
}

/** Why a commit, push or pull request was refused. */
export function noTaskReason(): string {
  return [
    "This session has no task in the task database, and every commit, push and pull request is traced to one.",
    "Find the task with task_search (or `tasks search --text ...`), or add it with task_add (or `tasks add`), then claim it with task_claim (or `tasks claim ID`) under your session name.",
    "Then run the same command again.",
  ].join(" ");
}

/** Why completing a task was refused. */
export function noDetailsReason(id: string, title: string | null): string {
  return [
    `Task ${id}${title ? ` ("${title}")` : ""} has no Details page. A task needs one before its pull request opens or it is completed, so a later question about what was done is answered from it.`,
    "Write a Markdown page in the vault, beside the client's other Details pages (find one with task_search and the detailsId of a task that has it): what was done, why, and the evidence (pull requests, commits, files, results). One sentence is enough when there is little to say.",
    "Set the task's detailsId to the page's file name in lower case with hyphens and no .md (task_update, or `tasks set ID --details <page>`), then complete it again.",
  ].join(" ");
}

/** The tasks recorded for a session. */
export function recorded(dir: string, session: string): string[] {
  try {
    const doc = JSON.parse(readFileSync(join(dir, `${session}.json`), "utf8"));
    return Array.isArray(doc.tasks)
      ? doc.tasks.filter((t: unknown) => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

/** Record tasks against a session, keeping the ones already there. */
export function record(dir: string, session: string, ids: string[]): void {
  const tasks = [...new Set([...recorded(dir, session), ...ids])];
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${session}.json`),
    JSON.stringify({ tasks, updatedAt: new Date().toISOString() }),
  );
}

/** A task's Details page id and title, or null when the database does not answer. */
function lookUp(
  cli: string,
  id: string,
): { detailsId: string | null; title: string | null } | null {
  const run = spawnSync("python3", [cli, "--json", "show", id], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (run.status !== 0) return null;
  try {
    const item = JSON.parse(run.stdout);
    return {
      detailsId: typeof item.detailsId === "string" ? item.detailsId : null,
      title: typeof item.title === "string" ? item.title : null,
    };
  } catch {
    return null;
  }
}

function deny(reason: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

if (import.meta.main) {
  let input: {
    hook_event_name?: string;
    session_id?: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_response?: unknown;
  } = {};
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    process.exit(0);
  }
  const dir =
    process.env.TASKS_TRACE_DIR ?? join(homedir(), ".claude", "tasks-trace");
  const session = String(input.session_id ?? "");
  const tool = String(input.tool_name ?? "");
  const args = input.tool_input ?? {};
  if (!session || !/^[\w-]+$/.test(session)) process.exit(0);

  if (input.hook_event_name === "PostToolUse") {
    const ids = taskIdsFrom(tool, args, input.tool_response);
    if (ids.length) record(dir, session, ids);
    process.exit(0);
  }

  if (input.hook_event_name !== "PreToolUse") process.exit(0);
  const cli = process.env.TASKS_CLI ?? join(import.meta.dir, "tasks");
  const done = completes(tool, args);
  if (done) {
    const task = lookUp(cli, done);
    if (task && !task.detailsId) deny(noDetailsReason(done, task.title));
    process.exit(0);
  }
  if (tool !== "Bash" || typeof args.command !== "string") process.exit(0);
  const kind = ships(args.command);
  if (!kind) process.exit(0);
  const tasks = recorded(dir, session);
  if (!tasks.length) {
    deny(noTaskReason());
    process.exit(0);
  }
  if (kind === "pr") {
    // The newest tasks first: the pull request is most likely for one of them.
    const found = [...tasks]
      .reverse()
      .slice(0, 5)
      .map((id) => ({ id, task: lookUp(cli, id) }));
    if (found.some((f) => f.task === null || f.task.detailsId)) process.exit(0);
    deny(noDetailsReason(found[0]!.id, found[0]!.task!.title));
  }
}
