/**
 * The ask and delivery hooks run as Claude Code runs them: as processes
 * with the hook input on standard input, against a fake Atlas and a fake
 * tasks server, in a throwaway home and configuration folder.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Call {
  arguments: Record<string, unknown>;
  name: string;
  server: "atlas" | "tasks";
}

let calls: Call[] = [];
let inbox: Record<string, unknown>[] = [];
let inboxAfterPolls = 0;
let polls = 0;

const server = Bun.serve({
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    const body = (await request.json()) as {
      params: { arguments: Record<string, unknown>; name: string };
    };
    const call = {
      arguments: body.params.arguments,
      name: body.params.name,
      server: path === "/atlas" ? "atlas" : "tasks",
    } as const;
    calls.push(call);
    let answer: unknown = {};
    if (call.name === "ask_question")
      answer = { questionId: "q-1", state: "open" };
    if (call.name === "message_inbox") {
      polls++;
      answer =
        polls > inboxAfterPolls
          ? inbox.filter((m) => m.to === call.arguments.to)
          : [];
    }
    if (call.name === "message_delivered")
      answer = { delivered: call.arguments.ids };
    return Response.json({
      id: 1,
      jsonrpc: "2.0",
      result: { content: [{ text: JSON.stringify(answer), type: "text" }] },
    });
  },
  port: 0,
});
afterAll(() => server.stop(true));

const root = mkdtempSync(join(tmpdir(), "ask-hooks-"));
const home = join(root, "home");
const config = join(home, ".claude-ultra-a");
mkdirSync(join(config, "sessions"), { recursive: true });
mkdirSync(join(home, ".claude"), { recursive: true });
writeFileSync(
  join(config, "sessions", "4242.json"),
  JSON.stringify({ name: "Builder", pid: process.pid, sessionId: "s-1" }),
);
writeFileSync(
  join(config, "sessions", "4243.json"),
  JSON.stringify({ name: "Vault", pid: process.pid, sessionId: "s-2" }),
);
mkdirSync(join(root, "trace"));
writeFileSync(
  join(root, "trace", "s-1.json"),
  JSON.stringify({ tasks: ["01old", "01task"] }),
);
writeFileSync(
  join(root, "roster.json"),
  JSON.stringify({ agents: [{ name: "Builder" }], commander: "Commander" }),
);

function writeAsk(extra: Record<string, unknown> = {}) {
  writeFileSync(
    join(config, "ask.json"),
    JSON.stringify({
      clients: { "/work/acme": "acme", "/work/vault": "vault-co" },
      ...extra,
    }),
  );
}

const env = (extra: Record<string, string> = {}) => ({
  ASK_OBSIDIAN_FILE: join(root, "obsidian.json"),
  ASK_STATE_DIR: join(root, "state"),
  ATLAS_MCP_URL: `http://127.0.0.1:${server.port}/atlas`,
  CLAUDE_CONFIG_DIR: config,
  CLAUDE_SESSIONS_DIR: join(config, "sessions"),
  COMMANDER_ROSTER: join(root, "roster.json"),
  HOME: home,
  NO_ASK_SKIP_PROCESS: "1",
  PATH: process.env.PATH ?? "",
  TASKS_MCP_TOKEN: "test-token",
  TASKS_MCP_URL: `http://127.0.0.1:${server.port}/tasks`,
  TASKS_TRACE_DIR: join(root, "trace"),
  ...extra,
});

async function run(
  script: string,
  input: Record<string, unknown>,
  extra: Record<string, string> = {},
  args: string[] = [],
) {
  const child = Bun.spawn(["bun", join(import.meta.dir, script), ...args], {
    env: env(extra),
    stderr: "pipe",
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stderr, stdout };
}

const askInput = (sessionId = "s-1", cwd = "/work/acme/app") => ({
  cwd,
  hook_event_name: "PreToolUse",
  session_id: sessionId,
  tool_input: {
    questions: [
      {
        header: "Region",
        options: [{ label: "West" }, { label: "North" }],
        question: "Which region should the cut-over use?",
      },
    ],
  },
  tool_name: "AskUserQuestion",
});

beforeEach(() => {
  calls = [];
  inbox = [];
  polls = 0;
  inboxAfterPolls = 0;
  writeAsk();
});

describe("the ask hook", () => {
  it("posts the question to Atlas and refuses the call with the question id", async () => {
    const { stdout } = await run("no-ask.ts", askInput());
    const output = JSON.parse(stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
      "Atlas question q-1",
    );
    expect(calls).toEqual([
      {
        arguments: {
          clientId: "acme",
          questions: [
            {
              header: "Region",
              options: [{ label: "West" }, { label: "North" }],
              question: "Which region should the cut-over use?",
            },
          ],
          session: expect.objectContaining({
            account: "ultra-a",
            address: "builder",
            sessionId: "s-1",
          }),
          taskId: "01task",
        },
        name: "ask_question",
        server: "atlas",
      },
    ]);
  });

  it("sends a card with no question text for a card-only client", async () => {
    writeAsk({ cardOnly: ["vault-co"] });
    const { stdout } = await run("no-ask.ts", askInput("s-2", "/work/vault"));
    expect(
      JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason,
    ).toContain("keeps questions inside its own tools");
    expect(calls[0]?.arguments.cardOnly).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("cut-over");
  });

  it("lets AskUserQuestion through for a session that opted out", async () => {
    const { stdout } = await run("no-ask.ts", askInput(), { ASK_HOOK: "off" });
    expect(stdout).toBe("");
    expect(calls).toEqual([]);
  });

  it("fails open when Atlas does not answer, except for a roster session", async () => {
    const down = { ATLAS_MCP_URL: "http://127.0.0.1:9/atlas" };
    const other = await run("no-ask.ts", askInput("s-2", "/work/vault"), down);
    expect(other.stdout).toBe("");
    const roster = await run("no-ask.ts", askInput(), down);
    expect(
      JSON.parse(roster.stdout).hookSpecificOutput.permissionDecisionReason,
    ).toContain("Atlas could not take this question");
  });

  it("lets the call through on input that is not JSON", async () => {
    const child = Bun.spawn(["bun", join(import.meta.dir, "no-ask.ts")], {
      env: env(),
      stdin: new Blob(["not json"]),
      stdout: "pipe",
    });
    expect(await new Response(child.stdout).text()).toBe("");
    expect(await child.exited).toBe(0);
  });
});

describe("the delivery hook", () => {
  const message = {
    createdAt: "2026-03-12T09:05:00Z",
    from: "atlas:server",
    id: "m-1",
    text: "Answer to your question q-1 (task 01task), from the owner through Atlas:\n- Which region should the cut-over use? → West",
    to: "builder",
  };

  it("adds new messages to the prompt, marks them delivered, and shows each once", async () => {
    inbox = [message];
    const input = {
      cwd: "/work/acme",
      hook_event_name: "UserPromptSubmit",
      session_id: "s-1",
    };
    const first = await run("deliver.ts", input);
    const output = JSON.parse(first.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput.additionalContext).toContain("→ West");
    expect(
      calls.find((c) => c.name === "message_delivered")?.arguments,
    ).toEqual({ by: "builder", ids: ["m-1"] });
    const second = await run("deliver.ts", input);
    expect(second.stdout).toBe("");
  });

  it("blocks a stop with new messages, and leaves a stop that a hook already continued", async () => {
    inbox = [{ ...message, id: "m-2" }];
    const stop = {
      cwd: "/work/acme",
      hook_event_name: "Stop",
      session_id: "s-1",
    };
    const continued = await run("deliver.ts", {
      ...stop,
      stop_hook_active: true,
    });
    expect(continued.stdout).toBe("");
    expect(calls).toEqual([]);
    const blocked = JSON.parse((await run("deliver.ts", stop)).stdout);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("q-1");
  });

  it("reads the id address too, so a message to either form arrives", async () => {
    inbox = [{ ...message, id: "m-3", to: "session-s1" }];
    const { stdout } = await run("deliver.ts", {
      hook_event_name: "SessionStart",
      session_id: "s-1",
    });
    expect(JSON.parse(stdout).hookSpecificOutput.additionalContext).toContain(
      "q-1",
    );
  });

  it("prints nothing when the tasks server does not answer", async () => {
    const { code, stdout } = await run(
      "deliver.ts",
      { hook_event_name: "UserPromptSubmit", session_id: "s-1" },
      { TASKS_MCP_URL: "http://127.0.0.1:9/tasks" },
    );
    expect(stdout).toBe("");
    expect(code).toBe(0);
  });
});

describe("the watcher", () => {
  it("waits for a message, then wakes the session with exit 2 and the message on stderr", async () => {
    inbox = [
      {
        createdAt: "2026-03-12T09:06:00Z",
        from: "reviewer",
        id: "m-9",
        text: "The review is done",
        to: "builder",
      },
    ];
    inboxAfterPolls = 2;
    const { code, stderr } = await run(
      "deliver.ts",
      { hook_event_name: "Stop", session_id: "s-1" },
      { ASK_WATCH_INTERVAL_SECONDS: "0.05", ASK_WATCH_SECONDS: "5" },
      ["watch"],
    );
    expect(code).toBe(2);
    expect(stderr).toContain("The review is done");
    expect(polls).toBeGreaterThan(2);
  });

  it("stops quietly when its time is up", async () => {
    const { code } = await run(
      "deliver.ts",
      { hook_event_name: "Stop", session_id: "s-1" },
      { ASK_WATCH_INTERVAL_SECONDS: "0.05", ASK_WATCH_SECONDS: "0.2" },
      ["watch"],
    );
    expect(code).toBe(0);
  });

  it("does not start when it is turned off", async () => {
    const { code } = await run(
      "deliver.ts",
      { hook_event_name: "Stop", session_id: "s-1" },
      { ASK_WATCH: "off" },
      ["watch"],
    );
    expect(code).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("ask.ts", () => {
  it("asks and returns at once with the question id", async () => {
    const child = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "ask.ts"),
        "ask",
        "--session-id",
        "s-1",
        "--question",
        "Ship today?",
        "--option",
        "Yes",
        "--option",
        "No",
      ],
      { env: env(), stderr: "pipe", stdout: "pipe" },
    );
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(stdout.split("\n")[0]!)).toEqual({
      cardOnly: false,
      questionId: "q-1",
    });
    expect(calls[0]?.arguments.questions).toEqual([
      { options: [{ label: "Yes" }, { label: "No" }], question: "Ship today?" },
    ]);
  });

  it("sends a message to another agent by name", async () => {
    const child = Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "ask.ts"),
        "message",
        "--session-id",
        "s-1",
        "--to",
        "Reviewer",
        "--text",
        "Ready for review",
        "--client",
        "acme",
      ],
      { env: env(), stderr: "pipe", stdout: "pipe" },
    );
    expect(await child.exited).toBe(0);
    expect(calls[0]).toEqual({
      arguments: {
        by: "builder",
        clientId: "acme",
        text: "Ready for review",
        to: "Reviewer",
      },
      name: "message_send",
      server: "tasks",
    });
  });
});
