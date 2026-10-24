import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type RunningServer, serve } from "../src/http.ts";
import { fixture } from "./setup.ts";

const CLI = resolve(import.meta.dir, "../../../plugins/tasks/scripts/tasks");
const TOKEN = "c".repeat(40);
let running: RunningServer;
let url: string;
// A HOME without settings.json, so only the environment configures the CLI.
const home = mkdtempSync(join(tmpdir(), "tasks-cli-"));

beforeAll(async () => {
  running = await serve(await fixture(), {
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
  });
  url = `http://127.0.0.1:${running.address.port}/mcp`;
});
afterAll(() => running.close());

// Asynchronous on purpose: a blocking spawn would stop the in-process test
// server from answering the very call the CLI waits for.
async function exec(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, {
    env: {
      HOME: home,
      PATH: process.env.PATH ?? "",
      TASKS_MCP_TOKEN: TOKEN,
      TASKS_MCP_URL: url,
      ...env,
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
const cli = (args: string[], env: Record<string, string> = {}) =>
  exec(["python3", CLI, ...args], env);

describe("tasks CLI", () => {
  test("adds, claims, starts, logs and completes an item, all under one name", async () => {
    expect((await cli(["clients"])).out).toContain("acme-delivery");
    const added = await cli([
      "--by",
      "Ops Portal",
      "--json",
      "add",
      "--client",
      "acme",
      "--title",
      "Ship the fix",
      "--day",
      "backlog",
      "--owner",
      "Gaps",
      "--waiting-on",
      "Magnus",
    ]);
    expect(added.code).toBe(0);
    const item = JSON.parse(added.out);
    expect(item).toMatchObject({ blocked: true, summary: "Owner: Gaps." });
    expect(item.scheduledFor).toBeUndefined();
    expect(
      (await cli(["search", "--client", "acme", "--blocked"])).out,
    ).toContain(item.id);
    const as = ["--by", "Ops Portal"];
    expect((await cli([...as, "claim", item.id])).code).toBe(0);
    expect(
      (await cli([...as, "start", item.id, "--note", "picked up"])).code,
    ).toBe(0);
    expect((await cli([...as, "log", item.id, "halfway"])).code).toBe(0);
    expect((await cli([...as, "done", item.id, "--note", "merged"])).code).toBe(
      0,
    );
    const shown = JSON.parse((await cli(["--json", "show", item.id])).out);
    expect(shown.state).toBe("done");
    expect(new Set(shown.history.map((h: { by: string }) => h.by))).toEqual(
      new Set(["ops-portal"]),
    );
    expect(shown.log.map((l: { note: string }) => l.note)).toEqual([
      "picked up",
      "halfway",
      "merged",
    ]);
    expect((await cli(["show", item.id])).out).toContain("log ");
  });

  test("another session's claim is refused with exit 1 and the server's reason", async () => {
    const added = await cli([
      "--by",
      "a",
      "--json",
      "add",
      "--client",
      "acme",
      "--title",
      "Claimed",
    ]);
    const item = JSON.parse(added.out);
    await cli(["--by", "a", "claim", item.id]);
    const r = await cli(["--by", "b", "claim", item.id]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("claimed by a");
  });

  test("a write without a name is refused before any call", async () => {
    const r = await cli(["add", "--client", "acme", "--title", "x"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--by");
  });

  test("a wrong token, no server address and an unreachable server each say so", async () => {
    expect(
      (await cli(["clients"], { TASKS_MCP_TOKEN: "x".repeat(40) })).code,
    ).toBe(3);
    const noUrl = await cli(["clients"], { TASKS_MCP_URL: "" });
    expect(noUrl.code).toBe(3);
    expect(noUrl.err).toContain("TASKS_MCP_URL");
    const down = await cli(["clients"], {
      TASKS_MCP_URL: "http://127.0.0.1:9/mcp",
    });
    expect(down.code).toBe(4);
    expect(down.err).toContain("didn't answer");
    expect(down.err + down.out).not.toContain(TOKEN);
  });
});

describe("tasks install", () => {
  test("writes a launcher that runs the newest installed copy, or this one", async () => {
    expect((await cli(["install"])).code).toBe(0);
    const launcher = join(home, ".local", "bin", "tasks");
    const text = readFileSync(launcher, "utf8");
    expect(text).toContain(".claude/plugins/cache/*/tasks/*/");
    expect(text).toContain(CLI);
    const viaLauncher = await exec(["sh", launcher, "clients"]);
    expect(viaLauncher.code).toBe(0);
    expect(viaLauncher.out).toContain("acme");
  });
});
