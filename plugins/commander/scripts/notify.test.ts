import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "notify.ts");

// A local stand-in for the Pushover API, so no test reaches the real one.
// The response depends on the message text.
let requests: URLSearchParams[] = [];
let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = new URLSearchParams(await req.text());
      requests.push(body);
      const msg = body.get("message") ?? "";
      if (msg.includes("refuse")) {
        return Response.json(
          { status: 0, errors: ["user identifier is invalid"], request: "r1" },
          { status: 400 },
        );
      }
      if (msg.includes("limit"))
        return Response.json(
          { status: 0, errors: [], request: "r2" },
          { status: 429 },
        );
      return Response.json({ status: 1, request: "ok-1" });
    },
  });
});
afterAll(() => server.stop(true));

interface Run {
  out: string;
  err: string;
  code: number;
  home: string;
}

interface Options {
  home?: string;
  roster?: object;
  env?: Record<string, string | undefined>;
}

async function run(argv: string[], o: Options = {}): Promise<Run> {
  const home = o.home ?? mkdtempSync(join(tmpdir(), "notify-"));
  const roster = join(home, "commander.json");
  writeFileSync(roster, JSON.stringify(o.roster ?? {}), "utf8");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    ...process.env,
    COMMANDER_HOME: home,
    COMMANDER_ROSTER: roster,
    NOTIFY_API: `http://127.0.0.1:${server.port}/1/messages.json`,
    PUSHOVER_APP_TOKEN: "test-token-0000000000000000000",
    PUSHOVER_USER_KEY: "test-user-00000000000000000000",
    ...o.env,
  })) {
    if (v !== undefined) env[k] = v;
  }
  const proc = Bun.spawn(["bun", SCRIPT, ...argv], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code, home };
}

const MSG = [
  "--key",
  "agent:Acme:stuck",
  "--title",
  "Acme stuck",
  "--message",
  "nudged twice",
];

test("dry run prints the request without the credentials", async () => {
  const r = await run(["send", ...MSG, "--dry-run"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("dry run: agent:Acme:stuck would POST");
  expect(r.out).toContain("token=<set>");
  expect(r.out).toContain("user=<set>");
  expect(r.out).not.toContain("test-token");
  expect(r.out).not.toContain("test-user");
});

test("missing credentials exit 2 and say which", async () => {
  const r = await run(["send", ...MSG, "--dry-run"], {
    env: { PUSHOVER_USER_KEY: undefined },
  });
  expect(r.code).toBe(2);
  expect(r.err).toContain("PUSHOVER_USER_KEY not set");
});

test("the same key sends once inside the window, then again after it", async () => {
  const first = await run(["send", ...MSG, "--dry-run"], {
    env: { NOTIFY_NOW: "2026-10-01T10:00:00Z" },
  });
  expect(first.out).toContain("dry run");
  const again = await run(["send", ...MSG, "--dry-run"], {
    home: first.home,
    env: { NOTIFY_NOW: "2026-10-01T10:20:00Z" },
  });
  expect(again.out).toContain("skipped: agent:Acme:stuck was sent 20m ago");
  const later = await run(["send", ...MSG, "--dry-run"], {
    home: first.home,
    env: { NOTIFY_NOW: "2026-10-01T10:31:00Z" },
  });
  expect(later.out).toContain("dry run");
});

test("clear by prefix lets the next send go out", async () => {
  const first = await run(["send", ...MSG, "--dry-run"]);
  const cleared = await run(["clear", "--prefix", "agent:Acme:"], {
    home: first.home,
  });
  expect(cleared.out).toContain("cleared: 1");
  const again = await run(["send", ...MSG, "--dry-run"], { home: first.home });
  expect(again.out).toContain("dry run");
});

test("quiet hours across midnight hold the push and record nothing", async () => {
  const roster = { notify: { quiet_hours: { start: "22:00", end: "07:00" } } };
  // NOTIFY_NOW is read in local time for quiet hours, so pin TZ.
  const night = await run(["send", ...MSG, "--dry-run"], {
    roster,
    env: { TZ: "UTC", NOTIFY_NOW: "2026-10-01T23:30:00Z" },
  });
  expect(night.out).toContain("held: quiet hours");
  const morning = await run(["send", ...MSG, "--dry-run"], {
    home: night.home,
    roster,
    env: { TZ: "UTC", NOTIFY_NOW: "2026-10-02T07:05:00Z" },
  });
  expect(morning.out).toContain("dry run");
});

test("disabled in the roster sends nothing, even without credentials", async () => {
  const r = await run(["send", ...MSG], {
    roster: { notify: { enabled: false } },
    env: { PUSHOVER_APP_TOKEN: undefined },
  });
  expect(r.code).toBe(0);
  expect(r.out).toContain("disabled");
});

test("priority 2 and bad arguments are refused", async () => {
  expect(
    (await run(["send", ...MSG, "--priority", "2", "--dry-run"])).code,
  ).toBe(2);
  expect((await run(["send", "--key", "k", "--dry-run"])).code).toBe(2);
  expect((await run(["nonsense"])).code).toBe(2);
});

test("an accepted push exits 0 and is recorded", async () => {
  requests = [];
  const r = await run([
    "send",
    ...MSG,
    "--url",
    "https://example.test/pr/1",
    "--url-title",
    "PR 1",
  ]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("sent: agent:Acme:stuck");
  expect(requests).toHaveLength(1);
  expect(requests[0].get("title")).toBe("Acme stuck");
  expect(requests[0].get("url_title")).toBe("PR 1");
  expect(readFileSync(join(r.home, "notify.log"), "utf8")).toContain(
    "sent agent:Acme:stuck",
  );
});

test("a refused push exits 1 with the API's reason and is not recorded", async () => {
  const r = await run([
    "send",
    "--key",
    "k1",
    "--title",
    "t",
    "--message",
    "please refuse",
  ]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("HTTP 400");
  expect(r.err).toContain("user identifier is invalid");
  expect(existsSync(join(r.home, "notify.json"))).toBe(false);
});

test("the monthly limit is named", async () => {
  const r = await run([
    "send",
    "--key",
    "k2",
    "--title",
    "t",
    "--message",
    "over the limit",
  ]);
  expect(r.code).toBe(1);
  expect(r.err).toContain("monthly message limit reached");
});

test("long text is cut to Pushover's limits", async () => {
  requests = [];
  await run([
    "send",
    "--key",
    "k3",
    "--title",
    "t".repeat(300),
    "--message",
    "m".repeat(2000),
  ]);
  expect(requests[0].get("title")).toHaveLength(250);
  expect(requests[0].get("message")).toHaveLength(1024);
});

async function waitFor(
  path: string,
  text: string,
  ms: number,
): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(path) && readFileSync(path, "utf8").includes(text))
      return true;
    await Bun.sleep(200);
  }
  return false;
}

test("a pending question is pushed by a timer that outlives the process that set it", async () => {
  const r = await run([
    "ask",
    "--key",
    "plan-0929",
    "--question",
    "Agree the plan?",
    "--after-seconds",
    "1",
    "--dry-run",
  ]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("pending: plan-0929");
  // The process that started the timer has exited. The push comes from the
  // detached timer, which is how it reaches the operator while the
  // commander session is blocked.
  expect(
    await waitFor(join(r.home, "notify.log"), "dry-run ask:plan-0929", 8000),
  ).toBe(true);
});

test("an answered question is not pushed when the timer fires", async () => {
  const r = await run([
    "ask",
    "--key",
    "q2",
    "--question",
    "Merge?",
    "--after-seconds",
    "1",
    "--dry-run",
  ]);
  await run(["answered", "--key", "q2"], { home: r.home });
  expect(
    await waitFor(
      join(r.home, "notify.log"),
      "timer q2: answered before it fired",
      8000,
    ),
  ).toBe(true);
  expect(readFileSync(join(r.home, "notify.log"), "utf8")).not.toContain(
    "dry-run ask:q2",
  );
});

test("due pushes only questions older than the threshold", async () => {
  const home = mkdtempSync(join(tmpdir(), "notify-"));
  writeFileSync(
    join(home, "pending.json"),
    JSON.stringify({
      old: { question: "Old question?", asked_at: "2026-10-01T09:00:00Z" },
      new: { question: "New question?", asked_at: "2026-10-01T09:50:00Z" },
    }),
  );
  const r = await run(["due", "--dry-run"], {
    home,
    env: { NOTIFY_NOW: "2026-10-01T10:00:00Z" },
  });
  expect(r.out).toContain("ask:old");
  expect(r.out).toContain("Old question? (asked 60m ago)");
  expect(r.out).not.toContain("ask:new");
});
