#!/usr/bin/env bun
/**
 * no-ask — a PreToolUse hook that refuses AskUserQuestion in the commander
 * and its roster workers.
 *
 * Those sessions run unattended. AskUserQuestion stops a session until the
 * operator answers in that session's own window, so a commander blocked on
 * one stops relaying everything, and a worker blocked on one stops its
 * work. The refusal tells the session how to ask instead, so the question
 * reaches the operator's Waiting on you list, where the Atlas sidebar
 * answers it with choices.
 *
 * Which sessions: the caller's session name, read from
 * ~/.claude/sessions/<pid>.json by its session id, is the roster's
 * commander or one of its agents. A roster name matches as a prefix,
 * without case, with spaces as hyphens ("Iviron" matches "iviron-69").
 * Sessions outside the roster, and any session when there is no roster,
 * keep AskUserQuestion. An unreadable input lets the call through, so a
 * broken hook never stops a session that is allowed to ask.
 *
 * Environment: COMMANDER_ROSTER (default ~/.claude/commander.json),
 * CLAUDE_SESSIONS_DIR (default ~/.claude/sessions), for tests.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

/** The roster's commander and agent names, or none without a readable roster. */
export function rosterNames(path: string): { commander: string | null; names: string[] } {
  try {
    const r = JSON.parse(readFileSync(path, "utf8"));
    const commander = typeof r.commander === "string" ? r.commander : null;
    const agents = Array.isArray(r.agents) ? r.agents : [];
    const names = agents
      .map((a: { name?: unknown }) => (typeof a?.name === "string" ? a.name : ""))
      .filter(Boolean);
    return { commander, names: commander ? [commander, ...names] : names };
  } catch {
    return { commander: null, names: [] };
  }
}

/** The roster name a session name falls under, if any. */
export function rosterMatch(session: string, names: readonly string[]): string | null {
  const s = norm(session);
  if (!s) return null;
  return names.find((n) => s === norm(n) || s.startsWith(`${norm(n)}-`)) ?? null;
}

/** A session's name from the session records, by its id. */
export function sessionName(dir: string, sessionId: string): string | null {
  if (!sessionId || !existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (rec?.sessionId === sessionId && typeof rec.name === "string") return rec.name;
    } catch {
      // a record being rewritten: skip it
    }
  }
  return null;
}

/** The refusal text: how the commander, or a worker, asks instead. */
export function reason(isCommander: boolean): string {
  return isCommander
    ? [
        "AskUserQuestion is off for the commander: it blocks this session, and while it waits nothing is relayed.",
        "Ask through the notify skill instead: `notify.ts ask --key <id> --question <question>`. The question goes to the pending list that the Atlas sidebar shows under Waiting on you, with a push to the operator's phone.",
        "Put up to four choices in the question text, then carry on with other work. The answer arrives as a dash request with action answer.",
      ].join(" ")
    : [
        "AskUserQuestion is off in roster worker sessions: it blocks this session until the operator opens it.",
        "Ask through the system instead, then carry on with other work:",
        "(1) for a task, task_update it blocked with blockedOn.waitingFor starting with the operator's name, for example \"Tobias: which support system does the customer use?\";",
        "(2) otherwise, message_send to Commander with the question and up to four choices.",
        "Either way it shows in the Atlas sidebar's Waiting on you, and the answer comes back to you through Commander.",
      ].join(" ");
}

if (import.meta.main) {
  let input: { session_id?: string } = {};
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    process.exit(0);
  }
  const home = homedir();
  const roster = rosterNames(process.env.COMMANDER_ROSTER ?? join(home, ".claude", "commander.json"));
  const name = sessionName(
    process.env.CLAUDE_SESSIONS_DIR ?? join(home, ".claude", "sessions"),
    String(input.session_id ?? ""),
  );
  const match = name ? rosterMatch(name, roster.names) : null;
  if (!match) process.exit(0);
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason(match === roster.commander),
      },
    }),
  );
}
