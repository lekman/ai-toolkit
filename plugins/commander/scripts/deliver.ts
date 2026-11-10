#!/usr/bin/env bun
/**
 * deliver — hooks that bring messages for this session from the tasks
 * server into the session: answers to its questions from Atlas, and
 * messages from other agents on any machine or Claude account.
 *
 * - `SessionStart` and `UserPromptSubmit` add new messages as context.
 * - `Stop` blocks the stop with new messages as its reason, so the agent
 *   reads them and goes on. It does nothing when the session is already
 *   continuing because of a stop hook (`stop_hook_active`).
 * - `deliver.ts watch`, run on `Stop` with `asyncRewake`, waits in the
 *   background while the session is idle. It polls the inbox every 30
 *   seconds and, when a message arrives, prints it to stderr and exits 2,
 *   which wakes the session. One watcher per session: a newer one takes
 *   over, and a watcher stops when its session's record is gone or its
 *   time is up.
 *
 * Each message is shown once: its id goes into the session's shown list
 * before it is printed, and it is marked delivered on the tasks server, so
 * Atlas can move the question to delivered. Every path fails open: no tasks
 * server, or one that does not answer, means no messages this time.
 *
 * Environment: see `ask.system.ts`; ASK_WATCH=off turns the watcher off;
 * ASK_WATCH_SECONDS (default 3300) and ASK_WATCH_INTERVAL_SECONDS (default
 * 30), for tests.
 */
import {
  deliveryOutput,
  type InboxMessage,
  messagesText,
  unseen,
  watchGoesOn,
  watchOn,
} from "./ask-logic.ts";
import {
  addSeen,
  askConfig,
  callTool,
  claimWatch,
  type Endpoint,
  hookInput,
  readInbox,
  readSeen,
  sessionAlive,
  sessionContext,
  tasksEndpoint,
  watchOwner,
} from "./ask.system.ts";

/** New messages for the session, recorded as shown and marked delivered. */
async function take(
  tasks: Endpoint,
  sessionId: string,
  addresses: string[],
): Promise<InboxMessage[]> {
  const fresh = unseen(await readInbox(tasks, addresses), readSeen(sessionId));
  if (!fresh.length) return [];
  const ids = fresh.map((message) => message.id);
  addSeen(sessionId, ids);
  try {
    await callTool(tasks, "message_delivered", { by: addresses[0], ids });
  } catch {
    // Shown is what matters to the session; Atlas sees delivery on a later mark.
  }
  return fresh;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

if (import.meta.main) {
  const input = await hookInput();
  if (!input) process.exit(0);
  const sessionId = String(input.session_id ?? "");
  const event = String(input.hook_event_name ?? "");
  const tasks = tasksEndpoint();
  if (!sessionId || !tasks) process.exit(0);

  if (process.argv[2] === "watch") {
    if (!watchOn(process.env, askConfig())) process.exit(0);
    const { addresses } = sessionContext(
      sessionId,
      String(input.cwd ?? process.cwd()),
    );
    claimWatch(sessionId, process.pid);
    const seconds = Number(process.env.ASK_WATCH_SECONDS) || 3300;
    const interval = Number(process.env.ASK_WATCH_INTERVAL_SECONDS) || 30;
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      await sleep(interval * 1000);
      const goesOn = watchGoesOn({
        deadline,
        myPid: process.pid,
        now: Date.now(),
        ownerPid: watchOwner(sessionId),
        sessionAlive: sessionAlive(sessionId),
      });
      if (!goesOn) process.exit(0);
      let fresh: InboxMessage[];
      try {
        fresh = await take(tasks, sessionId, addresses);
      } catch {
        continue;
      }
      if (fresh.length) {
        console.error(messagesText(fresh, addresses[0]!));
        process.exit(2);
      }
    }
  }

  if (!["SessionStart", "Stop", "UserPromptSubmit"].includes(event))
    process.exit(0);
  if (event === "Stop" && input.stop_hook_active === true) process.exit(0);
  const { addresses } = sessionContext(
    sessionId,
    String(input.cwd ?? process.cwd()),
  );
  let fresh: InboxMessage[];
  try {
    fresh = await take(tasks, sessionId, addresses);
  } catch {
    process.exit(0);
  }
  if (!fresh.length) process.exit(0);
  const output = deliveryOutput(event, messagesText(fresh, addresses[0]!));
  if (output) console.log(JSON.stringify(output));
}
