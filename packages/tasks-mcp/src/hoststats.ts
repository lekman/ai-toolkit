/**
 * Load numbers for the machines behind the dashboard: CPU, memory, swap, disk
 * and busy runners, one sample every 5 minutes per host. A collector on each
 * machine pushes samples, and Atlas lists them with the limits they break.
 *
 * A host is named within its client. A token scoped to one client that
 * pushes host "server" writes that client's "server", never another
 * client's, and lists only its own clients' hosts.
 *
 * Retention runs in the database (host_stat_rollup, migration 0006): 5-minute
 * samples for 7 days, then hourly averages until 97 days.
 */

import * as tables from "@lekman/dashboard-schema/db/schema";
import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import type { Context } from "./tasks.ts";

import { UnknownClient } from "./messages.ts";

/** The numbers in one sample. Each may be missing or null. */
export interface Numbers {
  cpuPct?: number | null;
  load1?: number | null;
  memFreePct?: number | null;
  swapUsedMb?: number | null;
  diskFreeGb?: number | null;
  runnersBusy?: number | null;
  runnersMax?: number | null;
}

/** A sample as host_stat_push takes it. */
export interface PushInput extends Numbers {
  clientId: string;
  host: string;
  sampledAt: string;
}

/** One limit a host is past. */
export interface Breach {
  metric: "cpuPct" | "diskFreeGb" | "lastSeen" | "memFreePct" | "swapUsedMb";
  level: "crit" | "warn";
  value: number;
  limit: number;
}

/** A host as host_stat_list returns it. */
export interface HostReport {
  clientId: string;
  host: string;
  lastSeen: string;
  latest: Required<Numbers>;
  samples: (Required<Numbers> & { at: string; resolution: "1h" | "5m" })[];
  breaches: Breach[];
}

/** Filters for host_stat_list. */
export interface ListInput {
  clientId?: string;
  host?: string;
  from?: string;
  to?: string;
}

/** Thrown when a push or a list asks for something the rules refuse. */
export class HostStatRefused extends Error {}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A sample may be stamped at most this far ahead of the server's clock. */
export const MAX_FUTURE_MINUTES = 5;
/** Older samples are refused: their hour may already be averaged. */
export const MAX_AGE_DAYS = 7;
/** The longest range host_stat_list returns: 7 days of samples plus 90 of averages. */
export const MAX_RANGE_DAYS = 97;

/**
 * Hosts that never sleep, so a gap in their samples is a fault. A laptop
 * sleeps, so it shows when it was last seen and raises nothing.
 */
export const ALWAYS_ON: readonly string[] = ["server"];

/**
 * The limits a host_stat_list breach is raised at. Memory, swap and disk are
 * judged on the latest sample, CPU on the mean of the samples in the last
 * `cpuPct.windowMinutes`, and lastSeen only for ALWAYS_ON hosts.
 *
 * The crit values must match the watchdog's (~/homelab/watchdog/watchdog.sh),
 * so Atlas and the watchdog's alerts agree. Tell Commander when they change.
 */
export const LIMITS = {
  memFreePct: { warn: 20, crit: 10 },
  swapUsedMb: { warn: 8192, crit: 24576 },
  diskFreeGb: { warn: 50, crit: 20 },
  cpuPct: { warn: 90, windowMinutes: 15 },
  // Three 5-minute samples missing, plus 2 minutes' grace for a late one.
  lastSeenMinutes: { warn: 17, crit: 60 },
} as const;

function inScope(ctx: Context, clientId: string): boolean {
  return !ctx.scope || ctx.scope.includes(clientId);
}

/** Postgres returns its own timestamp format; the tools speak ISO UTC. */
function iso(ts: Date | string): string {
  return new Date(ts).toISOString().replace(".000Z", "Z");
}

/**
 * Store one sample. Returns stored false when the host already has a sample
 * at that time, so a collector can retry without making a duplicate.
 */
export async function push(
  ctx: Context,
  input: PushInput,
): Promise<{
  stored: boolean;
  clientId: string;
  host: string;
  sampledAt: string;
}> {
  const { clientId, host } = input;
  if (!inScope(ctx, clientId)) throw new UnknownClient(clientId);
  const [owner] = await ctx.db
    .select({ id: tables.client.id })
    .from(tables.client)
    .where(eq(tables.client.id, clientId));
  if (!owner) throw new UnknownClient(clientId);

  const at = new Date(input.sampledAt);
  const now = ctx.now().getTime();
  if (at.getTime() > now + MAX_FUTURE_MINUTES * MINUTE) {
    throw new HostStatRefused(
      `sampledAt ${input.sampledAt} is more than ${MAX_FUTURE_MINUTES} minutes in the future. Check the collector's clock, and send UTC.`,
    );
  }
  if (at.getTime() < now - MAX_AGE_DAYS * DAY) {
    throw new HostStatRefused(
      `sampledAt ${input.sampledAt} is more than ${MAX_AGE_DAYS} days old. Drop the sample.`,
    );
  }
  const sampledAt = iso(at);
  const rows = await ctx.db
    .insert(tables.hostStat)
    .values({
      clientId,
      host,
      resolution: "5m",
      sampledAt,
      cpuPct: input.cpuPct ?? null,
      load1: input.load1 ?? null,
      memFreePct: input.memFreePct ?? null,
      swapUsedMb: input.swapUsedMb ?? null,
      diskFreeGb: input.diskFreeGb ?? null,
      runnersBusy: input.runnersBusy ?? null,
      runnersMax: input.runnersMax ?? null,
    })
    .onConflictDoNothing()
    .returning({ host: tables.hostStat.host });
  return { stored: rows.length > 0, clientId, host, sampledAt };
}

type Row = typeof tables.hostStat.$inferSelect;

function numbers(row: Row): Required<Numbers> {
  return {
    cpuPct: row.cpuPct,
    load1: row.load1,
    memFreePct: row.memFreePct,
    swapUsedMb: row.swapUsedMb,
    diskFreeGb: row.diskFreeGb,
    runnersBusy: row.runnersBusy,
    runnersMax: row.runnersMax,
  };
}

const key = (r: { clientId: string; host: string }) =>
  `${r.clientId}/${r.host}`;

/**
 * The limits a host is past. `latest` is its newest sample, `recentCpu` the
 * CPU readings of the last `LIMITS.cpuPct.windowMinutes`.
 */
export function breaches(
  host: string,
  latest: Required<Numbers>,
  lastSeen: Date,
  recentCpu: readonly number[],
  now: Date,
): Breach[] {
  const out: Breach[] = [];
  // The worse level wins, so a host past crit does not also report warn.
  // `shown` is the value reported, when it is rounded from the one compared.
  const judge = (
    metric: Breach["metric"],
    value: null | number,
    limits: { crit?: number; warn: number },
    past: (value: number, limit: number) => boolean,
    shown = value,
  ) => {
    if (value === null || shown === null) return;
    if (limits.crit !== undefined && past(value, limits.crit)) {
      out.push({ metric, level: "crit", value: shown, limit: limits.crit });
    } else if (past(value, limits.warn)) {
      out.push({ metric, level: "warn", value: shown, limit: limits.warn });
    }
  };
  const below = (v: number, l: number) => v < l;
  const above = (v: number, l: number) => v > l;

  judge("memFreePct", latest.memFreePct, LIMITS.memFreePct, below);
  judge("swapUsedMb", latest.swapUsedMb, LIMITS.swapUsedMb, above);
  judge("diskFreeGb", latest.diskFreeGb, LIMITS.diskFreeGb, below);
  if (recentCpu.length) {
    const mean = recentCpu.reduce((a, b) => a + b, 0) / recentCpu.length;
    const atLeast = (v: number, l: number) => v >= l;
    judge("cpuPct", mean, LIMITS.cpuPct, atLeast, Math.round(mean * 10) / 10);
  }
  if (ALWAYS_ON.includes(host)) {
    const minutes = (now.getTime() - lastSeen.getTime()) / MINUTE;
    judge(
      "lastSeen",
      minutes,
      LIMITS.lastSeenMinutes,
      above,
      Math.floor(minutes),
    );
  }
  return out;
}

/**
 * Hosts in the caller's scope with their newest sample, the limits they are
 * past, and their samples between `from` and `to`, oldest first. The newest
 * sample and the breaches describe the host now, whatever the range, so a
 * host with no samples in the range still shows when it was last seen.
 */
export async function list(
  ctx: Context,
  input: ListInput,
): Promise<{
  hosts: HostReport[];
  breachCount: { warn: number; crit: number };
}> {
  const now = ctx.now();
  const to = input.to ? new Date(input.to) : now;
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - DAY);
  if (from > to) throw new HostStatRefused("from is after to");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) {
    throw new HostStatRefused(
      `the range is longer than ${MAX_RANGE_DAYS} days, the longest kept`,
    );
  }
  const empty = { hosts: [], breachCount: { warn: 0, crit: 0 } };
  if (input.clientId && !inScope(ctx, input.clientId)) return empty;

  const h = tables.hostStat;
  const filter = [
    input.clientId ? eq(h.clientId, input.clientId) : undefined,
    !input.clientId && ctx.scope
      ? inArray(h.clientId, [...ctx.scope])
      : undefined,
    input.host ? eq(h.host, input.host) : undefined,
  ].filter((w) => w !== undefined);

  // The newest row of each host, at either resolution.
  const newest = await ctx.db
    .selectDistinctOn([h.clientId, h.host])
    .from(h)
    .where(filter.length ? and(...filter) : undefined)
    .orderBy(asc(h.clientId), asc(h.host), desc(h.sampledAt));
  if (!newest.length) return empty;

  const windowStart = new Date(
    now.getTime() - LIMITS.cpuPct.windowMinutes * MINUTE,
  );
  const recent = await ctx.db
    .select({ clientId: h.clientId, host: h.host, cpuPct: h.cpuPct })
    .from(h)
    .where(
      and(
        ...filter,
        eq(h.resolution, "5m"),
        gt(h.sampledAt, iso(windowStart)),
        lte(h.sampledAt, iso(now)),
      ),
    );
  const cpu = new Map<string, number[]>();
  for (const r of recent) {
    if (r.cpuPct === null) continue;
    cpu.set(key(r), [...(cpu.get(key(r)) ?? []), r.cpuPct]);
  }

  // Both resolutions: retention never keeps an hour's samples next to its
  // average, so the two do not overlap.
  const inRange = await ctx.db
    .select()
    .from(h)
    .where(
      and(...filter, gte(h.sampledAt, iso(from)), lte(h.sampledAt, iso(to))),
    )
    .orderBy(asc(h.sampledAt));
  const samples = new Map<string, HostReport["samples"]>();
  for (const r of inRange) {
    const list = samples.get(key(r)) ?? [];
    list.push({
      at: iso(r.sampledAt),
      resolution: r.resolution,
      ...numbers(r),
    });
    samples.set(key(r), list);
  }

  const breachCount = { warn: 0, crit: 0 };
  const hosts = newest.map((row): HostReport => {
    const latest = numbers(row);
    const found = breaches(
      row.host,
      latest,
      new Date(row.sampledAt),
      cpu.get(key(row)) ?? [],
      now,
    );
    for (const b of found) breachCount[b.level] += 1;
    return {
      clientId: row.clientId,
      host: row.host,
      lastSeen: iso(row.sampledAt),
      latest,
      samples: samples.get(key(row)) ?? [],
      breaches: found,
    };
  });
  return { hosts, breachCount };
}

/**
 * Run host_stat_rollup once. Returns the number of rows it deleted: samples
 * folded into hourly averages, and averages past 97 days.
 */
export async function rollup(ctx: Context): Promise<number> {
  const result = await ctx.db.execute<{ removed: number }>(
    sql`SELECT host_stat_rollup(${iso(ctx.now())}::timestamptz) AS removed`,
  );
  const rows = Array.isArray(result)
    ? result
    : (result as { rows: { removed: number }[] }).rows;
  return Number(rows[0]?.removed ?? 0);
}

/**
 * Run the rollup now and then every hour, until the returned function is
 * called. The timer does not keep the process alive, and a failure is logged
 * and tried again on the next run.
 */
export function startRollup(
  ctx: Context,
  log: (message: string) => void = console.error,
  everyMs = 60 * MINUTE,
): () => void {
  const once = () =>
    rollup(ctx).then(
      (removed) => {
        if (removed) log(`host_stat_rollup: ${removed} rows folded or expired`);
      },
      (error: unknown) =>
        log(
          `host_stat_rollup failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
  void once();
  const timer = setInterval(() => void once(), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
