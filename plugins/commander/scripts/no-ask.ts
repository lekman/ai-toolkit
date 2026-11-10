#!/usr/bin/env bun
/**
 * no-ask — a PreToolUse hook that turns `AskUserQuestion` into an Atlas
 * question, in every session on every account, so no session sits waiting
 * on the owner.
 *
 * The hook posts the call's questions to Atlas (`ask_question`), then
 * refuses the call with a reason that says it was automated, names the
 * question, tells the agent to keep working, and names the `commander:ask`
 * skill. The answer comes back to the session as a message, which
 * `deliver.ts` shows. A session whose client keeps questions inside its own
 * tools sends a card only: a fixed title, the task and a link, no text.
 *
 * A session keeps `AskUserQuestion` when it has opted out (`ASK_HOOK=off`,
 * `"hook": "off"` or its name in `optOut` in `ask.json`). When Atlas is not
 * configured or does not answer, the hook fails open: a session on the
 * Commander roster gets the older refusal that asks through Waiting on you,
 * so the Commander bridge stays the fallback, and any other session gets
 * `AskUserQuestion`. An unreadable input lets the call through.
 *
 * Environment: see `ask.system.ts`; COMMANDER_ROSTER (default
 * ~/.claude/commander.json), CLAUDE_SESSIONS_DIR and NO_ASK_SKIP_PROCESS,
 * for tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  atlasAsk,
  convertedReason,
  isCardOnly,
  optedOut,
  questionsFrom,
} from "./ask-logic.ts";
import {
  atlasEndpoint,
  callTool,
  hookInput,
  sessionContext,
} from "./ask.system.ts";

export { nameFromArgs, nameFromProcess } from "./ask.system.ts";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

/** The refusal text when Atlas cannot be reached: how the commander, or a worker, asks through Waiting on you. */
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
        '(1) for a task, task_update it blocked with blockedOn.waitingFor starting with the operator\'s name, for example "Tobias: which support system does the customer use?";',
        "(2) otherwise, message_send to Commander with the question and up to four choices.",
        "Either way it shows in the Atlas sidebar's Waiting on you, and the answer comes back to you through Commander.",
      ].join(" ");
}

/** The roster name a session name falls under, if any. */
export function rosterMatch(
  session: string,
  names: readonly string[],
): null | string {
  const s = norm(session);
  if (!s) return null;
  return (
    names.find((n) => s === norm(n) || s.startsWith(`${norm(n)}-`)) ?? null
  );
}

/** The roster's commander and agent names, or none without a readable roster. */
export function rosterNames(path: string): {
  commander: null | string;
  names: string[];
} {
  try {
    const r = JSON.parse(readFileSync(path, "utf8"));
    const commander = typeof r.commander === "string" ? r.commander : null;
    const agents = Array.isArray(r.agents) ? r.agents : [];
    const names = agents
      .map((a: { name?: unknown }) =>
        typeof a?.name === "string" ? a.name : "",
      )
      .filter(Boolean);
    return { commander, names: commander ? [commander, ...names] : names };
  } catch {
    return { commander: null, names: [] };
  }
}

/** A session's name from the session records, by its id. */
export function sessionName(dir: string, sessionId: string): null | string {
  if (!sessionId) return null;
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (rec?.sessionId === sessionId && typeof rec.name === "string")
        return rec.name;
    } catch {
      // a record being rewritten: skip it
    }
  }
  return null;
}

function deny(text: string): never {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: text,
      },
    }),
  );
  process.exit(0);
}

if (import.meta.main) {
  const input = await hookInput();
  if (!input) process.exit(0);
  const sessionId = String(input.session_id ?? "");
  const context = sessionContext(sessionId, String(input.cwd ?? process.cwd()));
  if (optedOut(process.env, context.config, context.addresses)) process.exit(0);

  const atlas = atlasEndpoint(context.config);
  const questions = questionsFrom(input.tool_input);
  const cardOnly = isCardOnly(context);
  if (atlas && (questions.length > 0 || cardOnly)) {
    try {
      const answer = (await callTool(
        atlas,
        "ask_question",
        { ...atlasAsk(context, questions) },
        5000,
      )) as { questionId?: unknown };
      if (typeof answer?.questionId === "string")
        deny(
          convertedReason(
            answer.questionId,
            cardOnly,
            context,
            join(import.meta.dir, "ask.ts"),
          ),
        );
    } catch {
      // Atlas did not take it: fall through to the roster rule, or let it through.
    }
  }

  const roster = rosterNames(
    process.env.COMMANDER_ROSTER ??
      join(homedir(), ".claude", "commander.json"),
  );
  const names = [
    sessionName(
      process.env.CLAUDE_SESSIONS_DIR ?? join(homedir(), ".claude", "sessions"),
      sessionId,
    ),
    ...context.addresses,
  ].filter((name): name is string => !!name);
  const match = names
    .map((name) => rosterMatch(name, roster.names))
    .find(Boolean);
  if (match)
    deny(
      `Atlas could not take this question, so the older way applies. ${reason(match === roster.commander)}`,
    );
}
