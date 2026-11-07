import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests for `tasks report`. The Python CLI runs against a local stand-in for
// the tasks MCP server, so no test reaches the real one.

const SCRIPT = join(import.meta.dir, "tasks");
const TOKEN = "test-token-report";

interface Item {
  clientId: string;
  detailsId?: string;
  history?: object[];
  id: string;
  log?: object[];
  pullRequests?: string[];
  state: string;
  title: string;
  tracker?: { key: string; system: string; url: string };
}

const CLIENTS = [
  { id: "acme", name: "Acme Ltd", workstreams: [] },
  { id: "globex", name: "Globex", workstreams: [] },
];

// The window under test is the weekend of 24 and 25 October 2026. British
// Summer Time ends at 01:00 UTC on the Sunday, so the Saturday starts at
// 23:00 UTC on the Friday and the Monday starts at 00:00 UTC.
const ITEMS: Item[] = [
  {
    clientId: "acme",
    detailsId: "acme-runner-setup",
    history: [
      {
        at: "2026-10-20T09:00:00Z",
        by: "admin",
        kind: "added",
        on: "2026-10-20",
      },
      {
        at: "2026-10-24T09:15:00Z",
        by: "builder",
        from: "todo",
        kind: "state",
        on: "2026-10-24",
        to: "doing",
      },
      {
        at: "2026-10-25T16:00:00Z",
        by: "gh-events",
        from: "doing",
        kind: "state",
        on: "2026-10-25",
        to: "merged",
      },
    ],
    id: "01aaaaaaaaaaaaaaaaaaaaaaaa",
    log: [
      {
        at: "2026-10-23T22:30:00Z",
        by: "builder",
        note: "Friday, before the window",
        status: "todo",
      },
      {
        at: "2026-10-23T23:30:00Z",
        by: "builder",
        note: "picked up after midnight",
        status: "doing",
      },
      {
        at: "2026-10-25T23:30:00.123Z",
        by: "builder",
        note: "late on Sunday",
        status: "doing",
      },
      {
        at: "2026-10-26T00:30:00Z",
        by: "builder",
        note: "Monday, after the window",
        status: "doing",
      },
    ],
    pullRequests: ["acme/api#12"],
    state: "merged",
    title: "Set up the build runner",
    tracker: {
      key: "ACME-7",
      system: "jira",
      url: "https://acme.atlassian.net/browse/ACME-7",
    },
  },
  {
    clientId: "acme",
    history: [
      {
        at: "2026-10-24T10:00:00Z",
        by: "planner",
        from: "2026-10-24",
        kind: "moved",
        on: "2026-10-24",
        to: "2026-10-27",
      },
      {
        at: "2026-10-24T10:05:00Z",
        by: "planner",
        kind: "edited",
        on: "2026-10-24",
      },
      {
        at: "2026-10-24T10:06:00Z",
        by: "builder",
        kind: "claimed",
        on: "2026-10-24",
      },
    ],
    id: "01bbbbbbbbbbbbbbbbbbbbbbbb",
    state: "todo",
    title: "Only planned this weekend",
  },
  {
    clientId: "globex",
    history: [
      {
        by: "builder",
        from: "doing",
        kind: "state",
        on: "2026-10-24",
        to: "done",
      },
    ],
    id: "01cccccccccccccccccccccccc",
    log: [
      {
        at: "2026-10-24T08:00:00Z",
        by: "lead",
        note: "rotated the keys",
        status: "doing",
      },
    ],
    state: "done",
    title: "Rotate the API keys",
  },
];

let items: Item[] = ITEMS;
let calls: {
  arguments: Record<string, unknown>;
  auth: string | null;
  name: string;
}[] = [];
let server: ReturnType<typeof Bun.serve>;

function answer(name: string, args: Record<string, unknown>): unknown {
  if (name === "client_list") return CLIENTS;
  if (name === "task_get") return items.find((i) => i.id === args.id);
  if (name === "task_search") {
    const states = (args.states as string[]) ?? [];
    const found = items.filter(
      (i) => i.clientId === args.clientId && states.includes(i.state),
    );
    const limit = (args.limit as number) ?? 25;
    return {
      count: found.length,
      items: found.slice(0, limit),
      today: "2026-11-07",
    };
  }
  throw new Error(`unexpected tool ${name}`);
}

beforeAll(() => {
  server = Bun.serve({
    async fetch(req) {
      const body = (await req.json()) as {
        params: { arguments: Record<string, unknown>; name: string };
      };
      const { arguments: args, name } = body.params;
      calls.push({
        arguments: args,
        auth: req.headers.get("authorization"),
        name,
      });
      const text = JSON.stringify(answer(name, args));
      return Response.json({
        id: 1,
        jsonrpc: "2.0",
        result: { content: [{ text, type: "text" }] },
      });
    },
    port: 0,
  });
});
afterAll(() => server.stop(true));
beforeEach(() => {
  items = ITEMS;
  calls = [];
});

async function tasks(
  ...argv: string[]
): Promise<{ code: number; err: string; out: string }> {
  const proc = Bun.spawn(["python3", SCRIPT, ...argv], {
    env: {
      HOME: mkdtempSync(join(tmpdir(), "tasks-report-")),
      PATH: process.env.PATH ?? "",
      TASKS_MCP_TOKEN: TOKEN,
      TASKS_MCP_URL: `http://127.0.0.1:${server.port}/mcp`,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, err, out };
}

async function json(...argv: string[]) {
  const r = await tasks("report", "--format", "json", ...argv);
  expect(r.code).toBe(0);
  return JSON.parse(r.out);
}

describe("tasks report", () => {
  it("keeps state changes and log notes in the window, by London time", async () => {
    const r = await json("--from", "2026-10-24", "--to", "2026-10-25");
    expect(r.from).toBe("2026-10-24");
    expect(r.to).toBe("2026-10-25");
    expect(r.scanned).toBe(3);
    const runner = r.clients[0].tasks[0];
    expect(runner.log.map((e: { note: string }) => e.note)).toEqual([
      "picked up after midnight",
      "late on Sunday",
    ]);
    expect(runner.log[0].local).toBe("Sat 2026-10-24 00:30");
    expect(runner.log[1].local).toBe("Sun 2026-10-25 23:30");
    expect(runner.stateChanges.map((e: { to: string }) => e.to)).toEqual([
      "doing",
      "merged",
    ]);
    expect(runner.tracker).toEqual({
      key: "ACME-7",
      url: "https://acme.atlassian.net/browse/ACME-7",
    });
    expect(runner.pullRequests).toEqual(["acme/api#12"]);
    expect(runner.detailsId).toBe("acme-runner-setup");
  });

  it("leaves out items that were only moved, edited or claimed", async () => {
    const r = await json("--from", "2026-10-24", "--to", "2026-10-25");
    const ids = r.clients.flatMap((c: { tasks: { id: string }[] }) =>
      c.tasks.map((t) => t.id),
    );
    expect(ids).toEqual([
      "01aaaaaaaaaaaaaaaaaaaaaaaa",
      "01cccccccccccccccccccccccc",
    ]);
    expect(r.active).toBe(2);
  });

  it("counts a history entry with only a day by that day", async () => {
    const r = await json("--from", "2026-10-24", "--client", "globex");
    expect(r.clients[0].tasks[0].stateChanges[0]).toMatchObject({
      from: "doing",
      local: "Sat 2026-10-24",
      to: "done",
    });
  });

  it("reports active tasks with no Details page as gaps", async () => {
    const r = await json("--from", "2026-10-24", "--to", "2026-10-25");
    expect(r.missingDetails).toEqual([
      {
        clientId: "globex",
        id: "01cccccccccccccccccccccccc",
        title: "Rotate the API keys",
      },
    ]);
  });

  it("reads only the named clients, in every state", async () => {
    const r = await json("--from", "2026-10-24", "--client", "globex");
    expect(r.clientIds).toEqual(["globex"]);
    const searches = calls.filter((c) => c.name === "task_search");
    expect(searches.map((c) => c.arguments.clientId)).toEqual(["globex"]);
    expect(searches[0].arguments.states).toEqual([
      "todo",
      "doing",
      "review",
      "approved",
      "merged",
      "done",
      "dropped",
    ]);
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("searches state by state when a client has more items than one search returns", async () => {
    const many: Item[] = Array.from({ length: 205 }, (_, n) => ({
      clientId: "acme",
      id: `01d${String(n).padStart(23, "0")}`,
      state: n < 202 ? "done" : "todo",
      title: `Old task ${n}`,
    }));
    items = [...ITEMS, ...many];
    const r = await json("--from", "2026-10-24", "--client", "acme");
    expect(r.scanned).toBe(2 + 200 + 3);
    expect(r.incomplete).toEqual([
      { clientId: "acme", count: 202, read: 200, state: "done" },
    ]);
    const md = await tasks(
      "report",
      "--from",
      "2026-10-24",
      "--client",
      "acme",
    );
    expect(md.out).toContain(
      "**Incomplete:** acme has 202 done tasks, and only 200 could be read.",
    );
  });

  it("prints Markdown by default", async () => {
    const r = await tasks(
      "report",
      "--from",
      "2026-10-24",
      "--to",
      "2026-10-25",
    );
    expect(r.code).toBe(0);
    const expected = [
      "# Work Report, 2026-10-24 to 2026-10-25",
      "",
      "Times are Europe/London. Read 3 tasks for acme, globex. 2 had activity in the window.",
      "",
      "## Acme Ltd (acme)",
      "",
      "### Set up the build runner",
      "",
      "- `01aaaaaaaaaaaaaaaaaaaaaaaa` · now merged · [ACME-7](https://acme.atlassian.net/browse/ACME-7) · Details `acme-runner-setup`",
      "- Pull requests [acme/api#12](https://github.com/acme/api/pull/12)",
      "- Sat 2026-10-24 00:30 doing: picked up after midnight (builder)",
      "- Sat 2026-10-24 10:15 state todo → doing (builder)",
      "- Sun 2026-10-25 16:00 state doing → merged (gh-events)",
      "- Sun 2026-10-25 23:30 doing: late on Sunday (builder)",
      "",
      "## Globex (globex)",
      "",
      "### Rotate the API keys",
      "",
      "- `01cccccccccccccccccccccccc` · now done · no Details page",
      "- Sat 2026-10-24 state doing → done (builder)",
      "- Sat 2026-10-24 09:00 doing: rotated the keys (lead)",
      "",
      "## Gaps",
      "",
      "These tasks had activity in the window but have no Details page:",
      "",
      "- Rotate the API keys (`01cccccccccccccccccccccccc`, globex)",
      "",
    ].join("\n");
    expect(r.out).toBe(expected);
  });

  it("says so when nothing happened", async () => {
    const r = await tasks("report", "--from", "2026-09-01");
    expect(r.out).toContain(
      "Read 3 tasks for acme, globex. 0 had activity in the window.",
    );
    expect(r.out).toContain("No activity in this window.");
  });

  it("refuses an unknown client and a window that ends before it starts", async () => {
    const unknown = await tasks("report", "--client", "initech");
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("no client initech");
    const backwards = await tasks(
      "report",
      "--from",
      "2026-10-25",
      "--to",
      "2026-10-24",
    );
    expect(backwards.code).toBe(2);
    expect(backwards.err).toContain("before it starts");
  });
});

describe("report periods", () => {
  // Loads the script as a module and asks for the window directly, with a fixed today.
  async function windowOf(
    start: string,
    end: string | null,
    today: string,
  ): Promise<string> {
    const code = [
      "import importlib.machinery, importlib.util, sys",
      "from datetime import date",
      `loader = importlib.machinery.SourceFileLoader("tasks", ${JSON.stringify(SCRIPT)})`,
      'spec = importlib.util.spec_from_loader("tasks", loader)',
      "t = importlib.util.module_from_spec(spec)",
      "loader.exec_module(t)",
      `a, b = t.window(${JSON.stringify(start)}, ${end === null ? "None" : JSON.stringify(end)}, date.fromisoformat(${JSON.stringify(today)}))`,
      "print(a.isoformat(), b.isoformat())",
    ].join("\n");
    const proc = Bun.spawn(["python3", "-c", code], {
      stderr: "pipe",
      stdout: "pipe",
    });
    return (await new Response(proc.stdout).text()).trim();
  }

  it("names whole weeks, the weekend before this week, and last month", async () => {
    // 2026-11-07 is a Saturday, 2026-11-09 a Monday.
    expect(await windowOf("last-weekend", null, "2026-11-07")).toBe(
      "2026-10-31 2026-11-01",
    );
    expect(await windowOf("last-weekend", null, "2026-11-09")).toBe(
      "2026-11-07 2026-11-08",
    );
    expect(await windowOf("last-week", null, "2026-11-07")).toBe(
      "2026-10-26 2026-11-01",
    );
    expect(await windowOf("this-week", null, "2026-11-07")).toBe(
      "2026-11-02 2026-11-08",
    );
    expect(await windowOf("last-month", null, "2026-01-15")).toBe(
      "2025-12-01 2025-12-31",
    );
    expect(await windowOf("yesterday", null, "2026-03-01")).toBe(
      "2026-02-28 2026-02-28",
    );
  });

  it("ends the window where --from's period ends, unless --to says otherwise", async () => {
    expect(await windowOf("2026-10-24", null, "2026-11-07")).toBe(
      "2026-10-24 2026-10-24",
    );
    expect(await windowOf("2026-10-01", "today", "2026-11-07")).toBe(
      "2026-10-01 2026-11-07",
    );
    expect(await windowOf("last-month", "last-week", "2026-11-07")).toBe(
      "2026-10-01 2026-11-01",
    );
  });
});
