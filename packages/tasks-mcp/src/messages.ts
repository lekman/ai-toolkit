/**
 * Messages between agent sessions, kept in the task database. A session that
 * can reach only the tasks server (a laptop behind a tunnel) sends its
 * messages here, and a relay that can reach the named session delivers them.
 *
 * Each message is about one client and carries that client's classification
 * and boundary. A scoped caller sends and reads only its clients' messages,
 * and its messages are signed with its token's name (`builder:acme-laptop`).
 */

import * as tables from "@lekman/dashboard-schema/db/schema";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";

import { actor, type Context } from "./tasks.ts";
import { ulid } from "./ulid.ts";

/** A message as the tools return it. */
export interface Message {
  id: string;
  clientId: string;
  from: string;
  to: string;
  text: string;
  createdAt: string;
  deliveredAt?: string;
  deliveredBy?: string;
}

/** Thrown when the client does not exist or is outside the caller's scope. */
export class UnknownClient extends Error {
  constructor(readonly clientId: string) {
    super(`no client ${clientId}`);
  }
}

function stamp(ctx: Context): string {
  return ctx
    .now()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

function inScope(ctx: Context, clientId: string): boolean {
  return !ctx.scope || ctx.scope.includes(clientId);
}

/** Postgres returns its own timestamp format; the tools speak ISO UTC. */
function iso(ts: string): string {
  return new Date(ts).toISOString().replace(".000Z", "Z");
}

function shape(row: typeof tables.message.$inferSelect): Message {
  const out: Message = {
    id: row.id,
    clientId: row.clientId,
    from: row.from,
    to: row.to,
    text: row.body,
    createdAt: iso(row.createdAt),
  };
  if (row.deliveredAt) out.deliveredAt = iso(row.deliveredAt);
  if (row.deliveredBy) out.deliveredBy = row.deliveredBy;
  return out;
}

/** Store a message from `by` to the session `to`, about `clientId`. */
export async function send(
  ctx: Context,
  by: string,
  to: string,
  clientId: string,
  text: string,
): Promise<{ id: string; createdAt: string }> {
  if (!inScope(ctx, clientId)) throw new UnknownClient(clientId);
  const [client] = await ctx.db
    .select()
    .from(tables.client)
    .where(eq(tables.client.id, clientId));
  if (!client) throw new UnknownClient(clientId);
  const row = {
    id: ulid(ctx.now().getTime()),
    classification: client.classification,
    boundary: client.boundary,
    clientId,
    from: ctx.caller ? `${actor(by)}:${actor(ctx.caller)}` : actor(by),
    to: actor(to),
    body: text,
    createdAt: stamp(ctx),
  };
  await ctx.db.insert(tables.message).values(row);
  return { id: row.id, createdAt: row.createdAt };
}

/** Filters for reading messages. */
export interface InboxInput {
  to?: string;
  undelivered?: boolean;
  since?: string;
  limit?: number;
}

/** Messages in the caller's scope, oldest first. */
export async function inbox(
  ctx: Context,
  input: InboxInput,
): Promise<Message[]> {
  const m = tables.message;
  const where = [
    input.to ? eq(m.to, actor(input.to)) : undefined,
    input.undelivered ? isNull(m.deliveredAt) : undefined,
    input.since ? gt(m.createdAt, input.since) : undefined,
    ctx.scope ? inArray(m.clientId, [...ctx.scope]) : undefined,
  ].filter((w) => w !== undefined);
  const rows = await ctx.db
    .select()
    .from(m)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(m.createdAt), asc(m.id))
    .limit(input.limit ?? 50);
  return rows.map(shape);
}

/**
 * Stamp messages as delivered by `by`. Only messages in scope and not yet
 * delivered change; returns the ids that did.
 */
export async function delivered(
  ctx: Context,
  by: string,
  ids: string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const m = tables.message;
  const where = [inArray(m.id, ids), isNull(m.deliveredAt)];
  if (ctx.scope) where.push(inArray(m.clientId, [...ctx.scope]));
  const rows = await ctx.db
    .update(m)
    .set({ deliveredAt: stamp(ctx), deliveredBy: actor(by) })
    .where(and(...where))
    .returning({ id: m.id });
  return rows.map((r) => r.id);
}
