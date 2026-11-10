#!/usr/bin/env bun
/**
 * ask — the `commander:ask` skill's command. Asks the owner through Atlas
 * and returns at once, sends a message to another agent, reads this
 * session's messages now, or prints this session's address.
 *
 *   ask.ts ask --question "…" [--header "…"] [--option "label[=description]"]… [--multi]
 *              [--question "…" …] [--task <id>] [--session-id <id>]
 *   ask.ts message --to <session> --text "…" [--client <id>]
 *   ask.ts inbox
 *   ask.ts whoami
 *
 * The session is found by its id (`--session-id`), else as the nearest
 * Claude Code process above this one. In a session whose client keeps
 * questions inside its own tools, `ask` sends a card only, never the text.
 *
 * Exit codes: 0 done, 1 refused or not reachable, 2 usage.
 */
import { join } from "node:path";

import {
  askInText,
  atlasAsk,
  isCardOnly,
  messagesText,
  parseAskArguments,
  unseen,
} from "./ask-logic.ts";
import {
  addSeen,
  askConfig,
  atlasEndpoint,
  callTool,
  readInbox,
  readSeen,
  sessionContext,
  sessionFromProcess,
  sessionRecord,
  tasksEndpoint,
} from "./ask.system.ts";

function fail(message: string, code = 1): never {
  console.error(`ask: ${message}`);
  process.exit(code);
}

/** The value after `flag`, or undefined. */
function option(argv: string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
}

if (import.meta.main) {
  const [command, ...argv] = process.argv.slice(2);
  const parsed = command === "ask" ? parseAskArguments(argv) : null;
  if (parsed && "error" in parsed) fail(parsed.error, 2);
  const explicitId = parsed?.sessionId ?? option(argv, "--session-id");
  const record = explicitId ? sessionRecord(explicitId) : sessionFromProcess();
  const sessionId = explicitId ?? record?.sessionId;
  if (!sessionId)
    fail("cannot tell which session this is: pass --session-id", 2);
  const context = sessionContext(
    sessionId,
    record?.cwd ?? process.cwd(),
    record,
  );
  if (parsed?.taskId) context.taskId = parsed.taskId;
  const me = context.addresses[0]!;

  if (command === "whoami") {
    console.log(
      JSON.stringify(
        {
          account: context.account,
          addresses: context.addresses,
          cardOnly: isCardOnly(context),
          client: context.clientId,
          host: context.host,
          sessionId,
          task: context.taskId,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (command === "ask" && parsed && !("error" in parsed)) {
    const cardOnly = isCardOnly(context);
    if (!cardOnly && parsed.questions.length === 0)
      fail("give at least one --question", 2);
    const atlas = atlasEndpoint(askConfig());
    if (!atlas)
      fail("no Atlas address: set ATLAS_MCP_URL, or atlasUrl in ask.json");
    let answer: { link?: string; questionId?: string };
    try {
      answer = (await callTool(
        atlas,
        "ask_question",
        {
          ...atlasAsk(context, cardOnly ? [] : parsed.questions, parsed.title),
        },
        8000,
      )) as typeof answer;
    } catch (error) {
      fail(`Atlas did not take the question (${(error as Error).message})`);
    }
    console.log(
      JSON.stringify({
        cardOnly,
        questionId: answer.questionId,
        ...(answer.link ? { link: answer.link } : {}),
      }),
    );
    console.log(
      cardOnly
        ? `Card sent with no text. Write the question ${askInText(context)}, then keep working. A message tells you when it is answered there.`
        : `Asked. Keep working on what does not depend on the answer; it arrives in this session as a message (to ${me}).`,
    );
    process.exit(0);
  }

  const tasks = tasksEndpoint();
  if (!tasks)
    fail(
      "no tasks server: set TASKS_MCP_URL and its token, as the tasks plugin needs",
    );

  if (command === "message") {
    const to = option(argv, "--to");
    const text = option(argv, "--text");
    const clientId = option(argv, "--client") ?? context.clientId;
    if (!to || !text) fail("message needs --to and --text", 2);
    if (!clientId) fail("no client for this folder: pass --client <id>", 2);
    try {
      const sent = await callTool(tasks, "message_send", {
        by: me,
        clientId,
        text,
        to,
      });
      console.log(JSON.stringify(sent));
    } catch (error) {
      fail(
        `the tasks server did not take the message (${(error as Error).message})`,
      );
    }
    process.exit(0);
  }

  if (command === "inbox") {
    try {
      const fresh = unseen(
        await readInbox(tasks, context.addresses, 8000),
        readSeen(sessionId),
      );
      if (!fresh.length) {
        console.log("No new messages.");
        process.exit(0);
      }
      const ids = fresh.map((message) => message.id);
      addSeen(sessionId, ids);
      await callTool(tasks, "message_delivered", { by: me, ids }).catch(
        () => undefined,
      );
      console.log(messagesText(fresh, me));
    } catch (error) {
      fail(`the tasks server did not answer (${(error as Error).message})`);
    }
    process.exit(0);
  }

  fail(
    `usage: bun ${join(import.meta.dir, "ask.ts")} ask|message|inbox|whoami …`,
    2,
  );
}
