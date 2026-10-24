/**
 * Reads and writes dashboard items. Works with any Drizzle Postgres database
 * (postgres-js in production, PGlite in tests).
 *
 * Writes are revision-checked: an update names the revision it read, and is
 * refused with RevisionConflict when someone else has written since. That is
 * the difference from the Obsidian file, where the last writer silently wins.
 */

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { and, asc, eq, sql } from "drizzle-orm";

import type { DashboardItem, HistoryEntry, LogEntry } from "../types.ts";

import * as schema from "./schema.ts";

/** A Drizzle Postgres database with this package's tables. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Thrown when an update names a revision that is no longer current. */
export class RevisionConflict extends Error {
  constructor(
    readonly id: string,
    readonly expected: number,
  ) {
    super(
      `item ${id} is not at revision ${expected}: someone else wrote first`,
    );
  }
}

type ItemRow = typeof schema.dashboardItem.$inferSelect;
type ItemInsert = typeof schema.dashboardItem.$inferInsert;

/** Item fields that live on the item row. The log and history are separate tables. */
function toRow(item: DashboardItem): ItemInsert {
  return {
    id: item.id,
    classification: item.classification,
    boundary: item.boundary,
    clientId: item.clientId,
    requirementId: item.requirementId ?? null,
    workstreamId: item.workstreamId ?? null,
    title: item.title,
    summary: item.summary ?? null,
    state: item.state,
    priority: item.priority,
    tracker: item.tracker ?? null,
    effort: item.effort ?? null,
    businessValue: item.businessValue ?? null,
    due: item.due ?? null,
    scheduledFor: item.scheduledFor ?? null,
    rank: item.rank ?? null,
    blocked: item.blocked ?? null,
    blockedSince: item.blockedOn?.since ?? null,
    blockedWaitingFor: item.blockedOn?.waitingFor ?? null,
    blockedReason: item.blockedOn?.reason ?? null,
    doneOn: item.doneOn ?? null,
    kind: item.kind ?? null,
    detailsId: item.detailsId ?? null,
    claimBy: item.claim?.by ?? null,
    claimAt: item.claim?.at ?? null,
    tags: item.tags ?? [],
    revision: item.revision,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** Drop null and undefined so a read item has the same shape as a written one. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined),
  ) as T;
}

/** Postgres returns `2026-10-24 11:18:00+00`; the model uses ISO with a Z. */
function iso(ts: string): string {
  return new Date(ts).toISOString().replace(".000Z", "Z");
}

function fromRows(
  row: ItemRow,
  log: (typeof schema.itemLog.$inferSelect)[],
  history: (typeof schema.itemHistory.$inferSelect)[],
): DashboardItem {
  const item: DashboardItem = compact({
    id: row.id,
    classification: row.classification,
    boundary: row.boundary,
    clientId: row.clientId,
    requirementId: row.requirementId,
    workstreamId: row.workstreamId,
    title: row.title,
    summary: row.summary,
    state: row.state,
    priority: row.priority,
    tracker: row.tracker as DashboardItem["tracker"],
    effort: row.effort,
    businessValue: row.businessValue,
    due: row.due,
    scheduledFor: row.scheduledFor,
    rank: row.rank,
    blocked: row.blocked,
    blockedOn:
      row.blockedSince && row.blockedWaitingFor
        ? compact({
            since: row.blockedSince,
            waitingFor: row.blockedWaitingFor,
            reason: row.blockedReason,
          })
        : null,
    doneOn: row.doneOn,
    kind: row.kind,
    detailsId: row.detailsId,
    claim:
      row.claimBy && row.claimAt
        ? { by: row.claimBy, at: iso(row.claimAt) }
        : null,
    tags: row.tags.length ? row.tags : null,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  } as unknown as DashboardItem);
  if (history.length) {
    item.history = history.map((h) =>
      compact({
        kind: h.kind,
        on: h.on,
        at: h.at ? iso(h.at) : null,
        by: h.by,
        from: h.from,
        to: h.to,
      }),
    ) as HistoryEntry[];
  }
  if (log.length) {
    item.log = log.map((l) =>
      compact({ at: iso(l.at), status: l.status, note: l.note, by: l.by }),
    ) as LogEntry[];
  }
  return item;
}

/** Insert a new item with its log and history, in one transaction. */
export async function insertItem(db: Db, item: DashboardItem): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(schema.dashboardItem).values(toRow(item));
    if (item.history?.length) {
      await tx.insert(schema.itemHistory).values(
        item.history.map((h) => ({
          itemId: item.id,
          kind: h.kind,
          on: h.on,
          at: h.at ?? null,
          by: h.by ?? null,
          from: h.from ?? null,
          to: h.to ?? null,
        })),
      );
    }
    if (item.log?.length) {
      await tx.insert(schema.itemLog).values(
        item.log.map((l) => ({
          itemId: item.id,
          at: l.at,
          status: l.status,
          note: l.note,
          by: l.by ?? null,
        })),
      );
    }
  });
}

/** One item with its log and history, or undefined when there is none. */
export async function getItem(
  db: Db,
  id: string,
): Promise<DashboardItem | undefined> {
  const [row] = await db
    .select()
    .from(schema.dashboardItem)
    .where(eq(schema.dashboardItem.id, id));
  if (!row) return undefined;
  const log = await db
    .select()
    .from(schema.itemLog)
    .where(eq(schema.itemLog.itemId, id))
    .orderBy(asc(schema.itemLog.at), asc(schema.itemLog.id));
  const history = await db
    .select()
    .from(schema.itemHistory)
    .where(eq(schema.itemHistory.itemId, id))
    .orderBy(asc(schema.itemHistory.on), asc(schema.itemHistory.id));
  return fromRows(row, log, history);
}

/** Every item for a client, without order: sort with compareItems, which computes priority. */
export async function listItems(
  db: Db,
  clientId: string,
): Promise<DashboardItem[]> {
  const rows = await db
    .select({ id: schema.dashboardItem.id })
    .from(schema.dashboardItem)
    .where(eq(schema.dashboardItem.clientId, clientId));
  const items = await Promise.all(rows.map((r) => getItem(db, r.id)));
  return items.filter((i): i is DashboardItem => i !== undefined);
}

/**
 * Replace the item's own fields, if it is still at `expectedRevision`. The
 * revision goes up by one and updatedAt is set by the database. The log and
 * history are untouched; append to them with appendLog and appendHistory.
 */
export async function updateItem(
  db: Db,
  item: DashboardItem,
  expectedRevision: number,
): Promise<number> {
  const row = toRow(item);
  const id = row.id;
  const fields: Partial<ItemInsert> = { ...row };
  delete fields.id;
  delete fields.revision;
  delete fields.createdAt;
  delete fields.updatedAt;
  const updated = await db
    .update(schema.dashboardItem)
    .set({
      ...fields,
      revision: sql`${schema.dashboardItem.revision} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.dashboardItem.id, id),
        eq(schema.dashboardItem.revision, expectedRevision),
      ),
    )
    .returning({ revision: schema.dashboardItem.revision });
  if (!updated[0]) throw new RevisionConflict(id, expectedRevision);
  return updated[0].revision;
}

/** Add a progress note. Notes are never edited or removed. */
export async function appendLog(
  db: Db,
  itemId: string,
  entry: LogEntry,
): Promise<void> {
  await db.insert(schema.itemLog).values({
    itemId,
    at: entry.at,
    status: entry.status,
    note: entry.note,
    by: entry.by ?? null,
  });
}

/** Record something that happened to the item. History is never edited or removed. */
export async function appendHistory(
  db: Db,
  itemId: string,
  entry: HistoryEntry,
): Promise<void> {
  await db.insert(schema.itemHistory).values({
    itemId,
    kind: entry.kind,
    on: entry.on,
    at: entry.at ?? null,
    by: entry.by ?? null,
    from: entry.from ?? null,
    to: entry.to ?? null,
  });
}
