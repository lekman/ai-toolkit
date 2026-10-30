import * as schema from "@lekman/dashboard-schema/db/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test } from "bun:test";

import type { Context } from "../src/tasks.ts";

import * as hoststats from "../src/hoststats.ts";
import { registerTaskTools } from "../src/tools.ts";
import { fixture } from "./setup.ts";

const NOW = "2026-10-24T09:00:00Z";
const MINUTE = 60_000;
const ago = (minutes: number) =>
  new Date(Date.parse(NOW) - minutes * MINUTE)
    .toISOString()
    .replace(".000Z", "Z");

/** Rows straight into the table, for times push refuses. */
async function seed(
  ctx: Context,
  rows: (typeof schema.hostStat.$inferInsert)[],
): Promise<void> {
  await ctx.db.insert(schema.hostStat).values(rows);
}

async function count(
  ctx: Awaited<ReturnType<typeof fixture>>,
  where: string,
): Promise<number> {
  const { rows } = await ctx.pg.query(
    `SELECT count(*)::int AS n FROM host_stat WHERE ${where}`,
  );
  return (rows[0] as { n: number }).n;
}

describe("host_stat_push", () => {
  test("stores a sample, and a retry of the same sample is not stored twice", async () => {
    const ctx = await fixture(NOW);
    const sample = {
      clientId: "acme",
      host: "server",
      sampledAt: "2026-10-24T08:55:00.000Z",
      cpuPct: 42.5,
      memFreePct: 31,
      swapUsedMb: 1024,
      runnersBusy: 1,
      runnersMax: 4,
    };
    expect(await hoststats.push(ctx, sample)).toEqual({
      stored: true,
      clientId: "acme",
      host: "server",
      sampledAt: "2026-10-24T08:55:00Z",
    });
    expect((await hoststats.push(ctx, sample)).stored).toBe(false);
    const { hosts } = await hoststats.list(ctx, {});
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.latest).toEqual({
      cpuPct: 42.5,
      load1: null,
      memFreePct: 31,
      swapUsedMb: 1024,
      diskFreeGb: null,
      runnersBusy: 1,
      runnersMax: 4,
    });
  });

  test("refuses a sample more than 5 minutes ahead or more than 7 days old", async () => {
    const ctx = await fixture(NOW);
    const at = (sampledAt: string) =>
      hoststats.push(ctx, { clientId: "acme", host: "server", sampledAt });
    expect((await at(ago(-5))).stored).toBe(true);
    await expect(at(ago(-6))).rejects.toThrow(/future/);
    expect((await at(ago(7 * 24 * 60))).stored).toBe(true);
    await expect(at(ago(7 * 24 * 60 + 1))).rejects.toThrow(/7 days old/);
  });

  test("an unknown client is refused as task_add refuses it", async () => {
    const ctx = await fixture(NOW);
    await expect(
      hoststats.push(ctx, {
        clientId: "nobody",
        host: "server",
        sampledAt: NOW,
      }),
    ).rejects.toThrow(/^no client nobody$/);
  });
});

describe("scope", () => {
  test("a scoped caller pushes and lists only its client's hosts; the full context lists all", async () => {
    const ctx = await fixture(NOW);
    const scoped = { ...ctx, scope: ["acme"], caller: "acme-laptop" };
    await hoststats.push(ctx, {
      clientId: "globex",
      host: "server",
      sampledAt: NOW,
      cpuPct: 10,
    });
    // The same host name under the scoped client is a different host.
    await hoststats.push(scoped, {
      clientId: "acme",
      host: "server",
      sampledAt: NOW,
      cpuPct: 99,
    });
    await expect(
      hoststats.push(scoped, {
        clientId: "globex",
        host: "server",
        sampledAt: ago(5),
      }),
    ).rejects.toThrow(/no client globex/);

    const seen = await hoststats.list(scoped, {});
    expect(seen.hosts.map((h) => `${h.clientId}/${h.host}`)).toEqual([
      "acme/server",
    ]);
    expect(seen.hosts[0]!.latest.cpuPct).toBe(99);
    expect(
      (await hoststats.list(scoped, { clientId: "globex" })).hosts,
    ).toEqual([]);

    const all = await hoststats.list(ctx, {});
    expect(all.hosts.map((h) => `${h.clientId}/${h.host}`)).toEqual([
      "acme/server",
      "globex/server",
    ]);
    expect(await count(ctx, "client_id = 'globex' AND cpu_pct = 10")).toBe(1);
  });
});

describe("host_stat_list", () => {
  test("refuses a range that runs backwards or is longer than 97 days", async () => {
    const ctx = await fixture(NOW);
    await expect(
      hoststats.list(ctx, { from: NOW, to: ago(60) }),
    ).rejects.toThrow(/after/);
    await expect(
      hoststats.list(ctx, { from: ago(97 * 24 * 60 + 1) }),
    ).rejects.toThrow(/97 days/);
    expect(
      (await hoststats.list(ctx, { from: ago(97 * 24 * 60) })).hosts,
    ).toEqual([]);
  });

  test("returns the last 24 hours by default, oldest first, and lastSeen whatever the range", async () => {
    const ctx = await fixture(NOW);
    await seed(ctx, [
      { clientId: "acme", host: "laptop", sampledAt: ago(25 * 60), cpuPct: 1 },
      { clientId: "acme", host: "laptop", sampledAt: ago(10), cpuPct: 3 },
      { clientId: "acme", host: "laptop", sampledAt: ago(20), cpuPct: 2 },
    ]);
    const [host] = (await hoststats.list(ctx, {})).hosts;
    expect(host!.samples.map((s) => s.cpuPct)).toEqual([2, 3]);
    expect(host!.lastSeen).toBe(ago(10));

    const old = await hoststats.list(ctx, {
      from: ago(26 * 60),
      to: ago(24 * 60),
    });
    expect(old.hosts[0]!.samples.map((s) => s.cpuPct)).toEqual([1]);
    expect(old.hosts[0]!.lastSeen).toBe(ago(10));
  });
});

describe("retention", () => {
  test("averages 5-minute samples older than 7 days into hours, and list returns hours before that", async () => {
    const ctx = await fixture(NOW);
    // 10 days of 5-minute samples. cpu is the minute of the hour, so each
    // hour's average is 27.5; swap alternates 100 and 201, rounding to 151.
    const rows: (typeof schema.hostStat.$inferInsert)[] = [];
    for (let m = 0; m <= 10 * 24 * 60; m += 5) {
      const at = ago(m);
      rows.push({
        clientId: "acme",
        host: "server",
        sampledAt: at,
        cpuPct: new Date(at).getUTCMinutes(),
        swapUsedMb: m % 10 === 0 ? 100 : 201,
        runnersMax: 4,
      });
    }
    await seed(ctx, rows);
    const cutoff = "2026-10-17T09:00:00Z";
    const before = await count(ctx, `sampled_at < '${cutoff}'`);
    expect(before).toBe(3 * 24 * 12);

    expect(await hoststats.rollup(ctx)).toBe(before);
    expect(
      await count(ctx, `resolution = '5m' AND sampled_at < '${cutoff}'`),
    ).toBe(0);
    expect(await count(ctx, `resolution = '1h'`)).toBe(3 * 24);
    expect(await count(ctx, `resolution = '5m'`)).toBe(7 * 24 * 12 + 1);
    const { rows: hour } = await ctx.pg.query(
      `SELECT cpu_pct, swap_used_mb, runners_max FROM host_stat WHERE resolution = '1h' LIMIT 1`,
    );
    expect(hour[0]).toEqual({
      cpu_pct: 27.5,
      swap_used_mb: 151,
      runners_max: 4,
    });

    // A second run finds nothing to do.
    expect(await hoststats.rollup(ctx)).toBe(0);
    expect(await count(ctx, `resolution = '1h'`)).toBe(3 * 24);

    const { hosts } = await hoststats.list(ctx, { from: ago(10 * 24 * 60) });
    const samples = hosts[0]!.samples;
    const firstFine = samples.findIndex((s) => s.resolution === "5m");
    expect(
      samples.slice(0, firstFine).every((s) => s.resolution === "1h"),
    ).toBe(true);
    expect(samples.slice(firstFine).every((s) => s.resolution === "5m")).toBe(
      true,
    );
    expect(samples[firstFine - 1]!.at).toBe("2026-10-17T08:00:00Z");
    expect(samples[firstFine]!.at).toBe(cutoff);
  });

  test("averages an hour only once all of it is past 7 days", async () => {
    const ctx = await fixture("2026-10-24T09:30:00Z");
    const rows: (typeof schema.hostStat.$inferInsert)[] = [];
    for (let m = 0; m < 120; m += 5) {
      rows.push({
        clientId: "acme",
        host: "server",
        sampledAt: new Date(Date.parse("2026-10-17T08:00:00Z") + m * MINUTE)
          .toISOString()
          .replace(".000Z", "Z"),
        cpuPct: m < 60 ? 10 : m < 90 ? 20 : 40,
      });
    }
    await seed(ctx, rows);
    // 09:00 to 09:25 on the 17th is past 7 days, but its hour is not.
    expect(await hoststats.rollup(ctx)).toBe(12);
    expect(await count(ctx, "resolution = '5m'")).toBe(12);
    (ctx as unknown as { at: string }).at = "2026-10-24T10:30:00Z";
    expect(await hoststats.rollup(ctx)).toBe(12);
    const { rows: hours } = await ctx.pg.query(
      "SELECT sampled_at, cpu_pct FROM host_stat ORDER BY sampled_at",
    );
    expect(hours.map((r) => (r as { cpu_pct: number }).cpu_pct)).toEqual([
      10, 30,
    ]);
  });

  test("deletes hourly averages older than 97 days", async () => {
    const ctx = await fixture(NOW);
    await seed(ctx, [
      {
        clientId: "acme",
        host: "server",
        resolution: "1h",
        sampledAt: ago(97 * 24 * 60 + 60),
      },
      {
        clientId: "acme",
        host: "server",
        resolution: "1h",
        sampledAt: ago(96 * 24 * 60),
      },
    ]);
    expect(await hoststats.rollup(ctx)).toBe(1);
    expect(await count(ctx, "true")).toBe(1);
  });

  test("startRollup runs at once, and logs a failure instead of throwing", async () => {
    const ctx = await fixture(NOW);
    await seed(ctx, [
      {
        clientId: "acme",
        host: "server",
        resolution: "1h",
        sampledAt: ago(98 * 24 * 60),
      },
    ]);
    const logged: string[] = [];
    const stop = hoststats.startRollup(ctx, (m) => logged.push(m));
    await Bun.sleep(50);
    stop();
    expect(logged).toEqual(["host_stat_rollup: 1 rows folded or expired"]);

    await ctx.pg.query("DROP FUNCTION host_stat_rollup");
    const failed: string[] = [];
    hoststats.startRollup(ctx, (m) => failed.push(m))();
    await Bun.sleep(50);
    expect(failed[0]).toMatch(/^host_stat_rollup failed/);
  });
});

describe("breaches", () => {
  const now = new Date(NOW);
  const none = {
    cpuPct: null,
    load1: null,
    memFreePct: null,
    swapUsedMb: null,
    diskFreeGb: null,
    runnersBusy: null,
    runnersMax: null,
  };
  const levels = (numbers: Partial<hoststats.Numbers>, cpu: number[] = []) =>
    hoststats
      .breaches("laptop", { ...none, ...numbers }, now, cpu, now)
      .map((b) => `${b.metric}:${b.level}:${b.limit}`);

  test("memory free below 20 warns and below 10 is critical", () => {
    expect(levels({ memFreePct: 20 })).toEqual([]);
    expect(levels({ memFreePct: 19.9 })).toEqual(["memFreePct:warn:20"]);
    expect(levels({ memFreePct: 9.9 })).toEqual(["memFreePct:crit:10"]);
  });

  test("swap above 8192 MB warns and above 24576 MB is critical", () => {
    expect(levels({ swapUsedMb: 8192 })).toEqual([]);
    expect(levels({ swapUsedMb: 8193 })).toEqual(["swapUsedMb:warn:8192"]);
    expect(levels({ swapUsedMb: 24577 })).toEqual(["swapUsedMb:crit:24576"]);
  });

  test("disk free below 50 GB warns and below 20 GB is critical", () => {
    expect(levels({ diskFreeGb: 50 })).toEqual([]);
    expect(levels({ diskFreeGb: 49 })).toEqual(["diskFreeGb:warn:50"]);
    expect(levels({ diskFreeGb: 19 })).toEqual(["diskFreeGb:crit:20"]);
  });

  test("CPU warns on a mean of 90 or more", () => {
    expect(levels({}, [95, 84])).toEqual([]);
    expect(levels({}, [95, 85])).toEqual(["cpuPct:warn:90"]);
  });

  test("lastSeen warns after 17 minutes and is critical after 60, for always-on hosts only", () => {
    const seen = (host: string, minutes: number, seconds = 0) =>
      hoststats
        .breaches(
          host,
          none,
          new Date(now.getTime() - minutes * MINUTE - seconds * 1000),
          [],
          now,
        )
        .map((b) => `${b.metric}:${b.level}`);
    expect(hoststats.ALWAYS_ON).toEqual(["server"]);
    expect(seen("server", 15, 59)).toEqual([]);
    expect(seen("server", 17)).toEqual([]);
    expect(seen("server", 17, 1)).toEqual(["lastSeen:warn"]);
    expect(seen("server", 60)).toEqual(["lastSeen:warn"]);
    expect(seen("server", 60, 1)).toEqual(["lastSeen:crit"]);
    expect(seen("laptop", 600)).toEqual([]);
  });

  test("list judges CPU on the last 15 minutes and counts breaches over the hosts returned", async () => {
    const ctx = await fixture(NOW);
    await seed(ctx, [
      // Outside the window: would pull the mean below 90.
      { clientId: "acme", host: "server", sampledAt: ago(20), cpuPct: 0 },
      { clientId: "acme", host: "server", sampledAt: ago(10), cpuPct: 90 },
      {
        clientId: "acme",
        host: "server",
        sampledAt: ago(5),
        cpuPct: 92,
        memFreePct: 5,
      },
      {
        clientId: "globex",
        host: "server",
        sampledAt: ago(30),
        diskFreeGb: 40,
      },
      {
        clientId: "globex",
        host: "laptop",
        sampledAt: ago(300),
        diskFreeGb: 10,
      },
    ]);
    const result = await hoststats.list(ctx, {});
    const by = Object.fromEntries(
      result.hosts.map((h) => [
        `${h.clientId}/${h.host}`,
        h.breaches.map((b) => `${b.metric}:${b.level}`),
      ]),
    );
    expect(by).toEqual({
      "acme/server": ["memFreePct:crit", "cpuPct:warn"],
      "globex/laptop": ["diskFreeGb:crit"],
      "globex/server": ["diskFreeGb:warn", "lastSeen:warn"],
    });
    expect(result.breachCount).toEqual({ warn: 3, crit: 2 });
    const scoped = await hoststats.list({ ...ctx, scope: ["acme"] }, {});
    expect(scoped.breachCount).toEqual({ warn: 1, crit: 1 });
  });
});

describe("tools", () => {
  async function client() {
    const ctx = await fixture(NOW);
    const server = new McpServer({ name: "tasks", version: "0.1.0" });
    registerTaskTools(server, ctx);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const c = new Client({ name: "test", version: "0" });
    await c.connect(b);
    return async (name: string, args: Record<string, unknown>) => {
      const result = await c.callTool({ name, arguments: args });
      return {
        isError: result.isError === true,
        text: (result.content as { text: string }[])[0]!.text,
      };
    };
  }

  test("host_stat_push checks names, times and ranges before storing", async () => {
    const call = await client();
    const base = { clientId: "acme", host: "server", sampledAt: NOW };
    const ok = await call("host_stat_push", {
      ...base,
      cpuPct: 100,
      load1: null,
      runnersBusy: 0,
      runnersMax: 1,
    });
    expect(ok.isError).toBe(false);
    expect(JSON.parse(ok.text).stored).toBe(true);
    expect(JSON.parse((await call("host_stat_push", base)).text).stored).toBe(
      false,
    );
    for (const bad of [
      { host: "Server" },
      { host: "-server" },
      { host: "a".repeat(65) },
      { sampledAt: "2026-10-24T09:00:00+01:00" },
      { sampledAt: "2026-10-24" },
      { cpuPct: 100.1 },
      { cpuPct: -1 },
      { load1: 1025 },
      { memFreePct: 101 },
      { swapUsedMb: 1.5 },
      { swapUsedMb: 1048577 },
      { diskFreeGb: 100001 },
      { runnersBusy: 65 },
      { runnersMax: 0 },
    ]) {
      const refused = await call("host_stat_push", { ...base, ...bad });
      expect(refused.isError).toBe(true);
    }
    const future = await call("host_stat_push", {
      ...base,
      sampledAt: ago(-6),
    });
    expect(future.text).toContain("future");
  });

  test("host_stat_list returns hosts and breachCount, and reports a bad range", async () => {
    const call = await client();
    await call("host_stat_push", {
      clientId: "acme",
      host: "server",
      sampledAt: ago(5),
      memFreePct: 15,
    });
    const listed = JSON.parse((await call("host_stat_list", {})).text);
    expect(listed.breachCount).toEqual({ warn: 1, crit: 0 });
    expect(listed.hosts[0].samples[0]).toMatchObject({
      at: ago(5),
      resolution: "5m",
      memFreePct: 15,
    });
    const bad = await call("host_stat_list", { from: NOW, to: ago(5) });
    expect(bad.isError).toBe(true);
  });
});
