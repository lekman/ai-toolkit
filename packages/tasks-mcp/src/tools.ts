import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  ClaimConflict,
  ItemNotFound,
  RevisionConflict,
} from "@lekman/dashboard-schema/db";
import { InvalidItem } from "@lekman/dashboard-schema/validate";
import { z } from "zod";

import * as hoststats from "./hoststats.ts";
import * as messages from "./messages.ts";
import * as tasks from "./tasks.ts";

/**
 * The tool names this server exposes, in registration order. A test checks
 * the registered surface against this list.
 */
export const TOOL_NAMES = [
  "task_search",
  "task_get",
  "client_list",
  "task_add",
  "task_update",
  "task_claim",
  "task_release",
  "task_log",
  "task_complete",
  "message_send",
  "message_inbox",
  "message_delivered",
  "host_stat_push",
  "host_stat_list",
] as const;

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(128);
const hostName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(64)
  .describe("The machine's name within its client, for example server");
const instant = z.iso.datetime();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("A date, YYYY-MM-DD");
const STATES = [
  "todo",
  "doing",
  "review",
  "approved",
  "merged",
  "done",
  "dropped",
] as const;
const state = z
  .enum(STATES)
  .describe(
    "review: a pull request waits for review. approved: approved, not merged. merged: merged, not yet released. " +
      "done: released, or finished for work that is never released. " +
      "gh-events moves an item with linked pullRequests through approved, merged and done on its own.",
  );
const by = z
  .string()
  .min(1)
  .max(96)
  .describe(
    "Who is acting: your session name, for example Builder or Commander. Stored in lower case with hyphens (Self-hosted runners becomes self-hosted-runners) and recorded in the history.",
  );
const revision = z
  .number()
  .int()
  .min(1)
  .describe(
    "The revision you read with task_get or task_search. A stale one is refused.",
  );
const note = z
  .string()
  .min(1)
  .max(160)
  .describe("A short progress note for the log, at most 160 characters");
const force = z
  .boolean()
  .optional()
  .describe(
    "Act on an item another agent has claimed. Only for an agent that has gone away.",
  );

const fields = {
  title: z.string().min(1).max(300).optional(),
  summary: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .describe("The current state in plain language, about 550 characters"),
  priority: z
    .enum(["high", "normal", "low"])
    .optional()
    .describe(
      "Stored priority. Only used until businessValue and effort are both set; then priority is computed.",
    ),
  workstreamId: id
    .nullable()
    .optional()
    .describe("A workstream of the same client, from client_list"),
  requirementId: id.nullable().optional(),
  scheduledFor: day
    .nullable()
    .optional()
    .describe("The day it is planned for. Null means unscheduled."),
  due: day
    .nullable()
    .optional()
    .describe("A real deadline only. It raises urgency."),
  businessValue: z
    .enum(["negative", "none", "low", "medium", "high", "veryHigh"])
    .nullable()
    .optional(),
  effort: z.enum(["XS", "S", "M", "L", "XL"]).nullable().optional(),
  rank: z.string().max(32).nullable().optional(),
  kind: z.enum(["work", "admin"]).nullable().optional(),
  tracker: z
    .object({
      system: z.enum(["jira", "monday", "github", "other"]),
      key: z.string().min(1).max(64),
      url: z.string().url(),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).nullable().optional(),
  pullRequests: z
    .array(
      z
        .string()
        .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[0-9]+$/)
        .max(140),
    )
    .max(30)
    .nullable()
    .optional()
    .describe(
      "The item's own pull requests as owner/repo#number. Give the whole list: add yours when you open one. Readers then show only these.",
    ),
  blocked: z.boolean().nullable().optional(),
  blockedOn: z
    .object({
      since: day,
      waitingFor: z.string().min(1).max(140),
      reason: z.string().max(280).optional(),
    })
    .nullable()
    .optional()
    .describe("Who or what it waits for. Only with blocked true."),
  detailsId: id.nullable().optional(),
};

const text = (payload: unknown) => ({
  content: [
    {
      type: "text" as const,
      text:
        typeof payload === "string"
          ? payload
          : JSON.stringify(payload, null, 2),
    },
  ],
});

/** Turn a known failure into a message the agent can act on. */
function failure(error: unknown) {
  let message: string;
  if (error instanceof RevisionConflict) {
    message = `${error.message}. Read it again with task_get, then retry with the new revision.`;
  } else if (error instanceof ClaimConflict) {
    message = `${error.message}. Pick another item, or ask that agent to release it.`;
  } else if (error instanceof messages.UnknownClient) {
    message = `${error.message}. Find the client id with client_list.`;
  } else if (error instanceof ItemNotFound) {
    message = `${error.message}. Find the id with task_search.`;
  } else if (error instanceof InvalidItem) {
    message = error.message;
  } else if (
    error instanceof tasks.NothingToChange ||
    error instanceof tasks.InvalidActor ||
    error instanceof hoststats.HostStatRefused
  ) {
    message = error.message;
  } else {
    message = error instanceof Error ? error.message : String(error);
  }
  return { ...text(message), isError: true };
}

async function run(work: () => Promise<unknown>) {
  try {
    return text(await work());
  } catch (error) {
    return failure(error);
  }
}

/**
 * Register the task tools. Shared by the stdio and HTTP servers, so both
 * expose the same surface.
 */
export function registerTaskTools(server: McpServer, ctx: tasks.Context): void {
  server.registerTool(
    "task_search",
    {
      description:
        "Find dashboard items. Returns open items (todo, doing, review, approved, merged) unless states says otherwise, " +
        "most important first: computed priority, then urgency from the due date. " +
        "Use task_get to read one in full before changing it.",
      inputSchema: {
        clientId: id.optional().describe("A client id from client_list"),
        states: z.array(state).optional(),
        text: z
          .string()
          .max(200)
          .optional()
          .describe("Words to find in the title or summary"),
        workstreamId: id.optional(),
        claimedBy: z.string().max(96).optional(),
        unclaimed: z
          .boolean()
          .optional()
          .describe("Only items nobody has claimed"),
        blocked: z.boolean().optional(),
        tag: z.string().max(40).optional(),
        trackerKey: z
          .string()
          .max(64)
          .optional()
          .describe("A ticket key, for example #250 or ADX-12"),
        pullRequest: z
          .string()
          .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}#\d+$/)
          .optional()
          .describe("Items linking this pull request, owner/repo#number"),
        scheduledFrom: day.optional(),
        scheduledTo: day.optional(),
        dueBy: day.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => tasks.search(ctx, args)),
  );

  server.registerTool(
    "task_get",
    {
      description:
        "Read one item in full: its fields, log, history, revision and computed priority with the reason.",
      inputSchema: { id },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(() => tasks.read(ctx, id)),
  );

  server.registerTool(
    "client_list",
    {
      description:
        "The clients and their workstreams, with the ids task_add and task_search take.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => tasks.clients(ctx)),
  );

  server.registerTool(
    "task_add",
    {
      description:
        "Add an item for a client. It takes the client's classification and boundary and starts as todo. " +
        "Search first, so the same work is not added twice.",
      inputSchema: {
        by,
        clientId: id.describe("A client id from client_list"),
        ...fields,
        title: z.string().min(1).max(300),
      },
    },
    ({ by, clientId, ...rest }) =>
      run(() =>
        tasks.add(
          ctx,
          by,
          clientId,
          rest as tasks.ItemFields & { title: string },
        ),
      ),
  );

  server.registerTool(
    "task_update",
    {
      description:
        "Change an item's fields at the revision you read. Set a field to null to clear it. " +
        "Moves, state changes and edits are recorded in the history. " +
        "Use task_complete to finish an item, and task_claim before you start work on one.",
      inputSchema: {
        by,
        id,
        revision,
        state: state.optional(),
        ...fields,
        note: note.optional(),
        force,
      },
    },
    ({ by, id, revision, note, force, ...rest }) =>
      run(async () => ({
        id,
        revision: await tasks.update(ctx, by, id, revision, rest, {
          note,
          force,
        }),
      })),
  );

  server.registerTool(
    "task_claim",
    {
      description:
        "Claim an item before working on it, so other agents leave it alone. " +
        "Refused when another agent holds it. Claiming one you already hold is fine.",
      inputSchema: { by, id },
    },
    ({ by, id }) =>
      run(async () => ({ id, revision: await tasks.claim(ctx, by, id) })),
  );

  server.registerTool(
    "task_release",
    {
      description:
        "Give up your claim on an item, for example when you stop without finishing.",
      inputSchema: { by, id, force },
    },
    ({ by, id, force }) =>
      run(async () => ({
        id,
        revision: await tasks.release(ctx, by, id, force),
      })),
  );

  server.registerTool(
    "task_log",
    {
      description:
        "Add a short progress note to an item's log. The log is append only and does not change the revision.",
      inputSchema: {
        by,
        id,
        status: z.enum([...STATES, "blocked"]),
        note,
      },
    },
    ({ by, id, status, note }) =>
      run(async () => {
        await tasks.log(ctx, by, id, status, note);
        return { id, logged: true };
      }),
  );

  server.registerTool(
    "task_complete",
    {
      description:
        "Mark an item done, today unless on says otherwise. Clears its claim and blocked details.",
      inputSchema: {
        by,
        id,
        revision,
        note: note.optional(),
        on: day.optional().describe("The day it was finished, if not today"),
        force,
      },
    },
    ({ by, id, revision, note, on, force }) =>
      run(async () => ({
        id,
        revision: await tasks.complete(ctx, by, id, revision, {
          note,
          on,
          force,
        }),
      })),
  );

  server.registerTool(
    "message_send",
    {
      description:
        "Send a message to another agent session by its name, for example Commander or Lekman. " +
        "Use it to answer a session you cannot reach directly: a relay delivers it to the named session. " +
        "The message is about one client and is visible only to callers allowed that client.",
      inputSchema: {
        by,
        to: z
          .string()
          .min(1)
          .max(96)
          .describe(
            "The session to deliver to, by the name other sessions use for it",
          ),
        clientId: id.describe(
          "The client the message is about, from client_list",
        ),
        text: z
          .string()
          .min(1)
          .max(4000)
          .describe("The message, at most 4000 characters"),
      },
    },
    ({ by, to, clientId, text }) =>
      run(async () => messages.send(ctx, by, to, clientId, text)),
  );

  server.registerTool(
    "message_inbox",
    {
      description:
        "Read messages, oldest first: those sent to a session (to), or every one not yet delivered (undelivered). " +
        "A session that cannot be reached directly reads its replies here.",
      inputSchema: {
        to: z
          .string()
          .min(1)
          .max(96)
          .optional()
          .describe("Only messages to this session"),
        undelivered: z
          .boolean()
          .optional()
          .describe("Only messages no relay has delivered yet"),
        since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
          .optional()
          .describe("Only messages created after this time, ISO UTC"),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    (input) =>
      run(async () => ({ messages: await messages.inbox(ctx, input) })),
  );

  server.registerTool(
    "message_delivered",
    {
      description:
        "Mark messages delivered, once you have passed them to their session or read your own. " +
        "Messages already marked stay as they were.",
      inputSchema: {
        by,
        ids: z.array(id).min(1).max(200),
      },
    },
    ({ by, ids }) =>
      run(async () => ({ delivered: await messages.delivered(ctx, by, ids) })),
  );

  server.registerTool(
    "host_stat_push",
    {
      description:
        "Store one load sample for a machine: CPU, memory, swap, disk and runners, every 5 minutes. " +
        "The host is named within the client, so each client has its own hosts. " +
        "stored false means a sample for that host and time is already there, so a retry is safe. " +
        "Leave out a number the machine does not have.",
      inputSchema: {
        clientId: id.describe(
          "The client the machine belongs to, from client_list",
        ),
        host: hostName,
        sampledAt: instant.describe(
          "When the sample was taken, ISO UTC with a Z. Refused when more than 5 minutes ahead or more than 7 days old.",
        ),
        cpuPct: z
          .number()
          .min(0)
          .max(100)
          .nullable()
          .optional()
          .describe("CPU in use, percent"),
        load1: z
          .number()
          .min(0)
          .max(1024)
          .nullable()
          .optional()
          .describe("Load average over 1 minute"),
        memFreePct: z
          .number()
          .min(0)
          .max(100)
          .nullable()
          .optional()
          .describe("Memory free, percent, as memory_pressure reports it"),
        swapUsedMb: z
          .number()
          .int()
          .min(0)
          .max(1048576)
          .nullable()
          .optional()
          .describe("Swap in use, MB"),
        diskFreeGb: z
          .number()
          .min(0)
          .max(100000)
          .nullable()
          .optional()
          .describe("Free space on the main volume, GB"),
        runnersBusy: z
          .number()
          .int()
          .min(0)
          .max(64)
          .nullable()
          .optional()
          .describe("Runner containers working"),
        runnersMax: z
          .number()
          .int()
          .min(1)
          .max(64)
          .nullable()
          .optional()
          .describe("Runner containers allowed"),
      },
    },
    (input) => run(() => hoststats.push(ctx, input)),
  );

  server.registerTool(
    "host_stat_list",
    {
      description:
        "Machines' load: for each host its newest numbers, when it was last seen, the limits it is past (warn or crit), " +
        "and its samples in the range, oldest first. Samples are every 5 minutes for the last 7 days and hourly averages before that. " +
        "The newest numbers and the limits describe the host now, whatever the range.",
      inputSchema: {
        clientId: id
          .optional()
          .describe(
            "Only this client's hosts. Leave out for every client you may see.",
          ),
        host: hostName.optional(),
        from: instant
          .optional()
          .describe("Start of the range, ISO UTC. Default 24 hours before to."),
        to: instant
          .optional()
          .describe(
            "End of the range, ISO UTC. Default now. At most 97 days after from.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => run(() => hoststats.list(ctx, input)),
  );
}
