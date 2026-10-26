/**
 * What an agent can do to dashboard items, independent of MCP. The tools in
 * tools.ts are a thin layer over these functions.
 *
 * Every write names the agent (`by`), and lands in the item's history. An
 * item claimed by one agent cannot be updated or completed by another unless
 * the caller passes `force`. Updates name the revision they read, so a stale
 * write is refused instead of overwriting someone else's.
 */

import type { Db } from "@lekman/dashboard-schema/db";

import {
  assess,
  type Assessment,
  type BusinessValue,
  compareItems,
  type DashboardItem,
  type Effort,
  type HistoryEntry,
  type Priority,
  type State,
  type Tracker,
} from "@lekman/dashboard-schema";
import {
  appendLog,
  ClaimConflict,
  claimItem,
  getItem,
  insertItem,
  ItemNotFound,
  releaseItem,
  searchItems,
  updateItem,
} from "@lekman/dashboard-schema/db";
import * as tables from "@lekman/dashboard-schema/db/schema";
import { validateItem } from "@lekman/dashboard-schema/validate";
import { eq } from "drizzle-orm";

import { ulid } from "./ulid.ts";

/** The database and the clock the operations run against. */
export interface Context {
  db: Db;
  /** The current time. Tests pass a fixed one. */
  now: () => Date;
  /** The time zone that decides what "today" is, for example Europe/London. */
  timeZone: string;
  /**
   * The clients this caller may read and write. Absent means every client.
   * An item outside the scope behaves as if it did not exist.
   */
  scope?: readonly string[];
  /**
   * The scoped token's name, for a caller that presented one. Messages from
   * such a caller are signed with it, so the sender cannot claim to be
   * another session.
   */
  caller?: string;
}

function inScope(ctx: Context, clientId: string): boolean {
  return !ctx.scope || ctx.scope.includes(clientId);
}

/** The item, or ItemNotFound when it does not exist or is outside the scope. */
async function visible(ctx: Context, id: string): Promise<DashboardItem> {
  const item = await getItem(ctx.db, id);
  if (!item || !inScope(ctx, item.clientId)) throw new ItemNotFound(id);
  return item;
}

/** The open states, used when a search names none. */
export const OPEN_STATES: readonly State[] = ["todo", "doing", "review"];

/** An item in a search result: enough to choose one, without its prose. */
export interface ItemSummary {
  id: string;
  clientId: string;
  title: string;
  state: State;
  workstreamId?: string;
  scheduledFor?: string;
  due?: string;
  doneOn?: string;
  kind?: "work" | "admin";
  blocked?: boolean;
  claimedBy?: string;
  trackerKey?: string;
  trackerUrl?: string;
  detailsId?: string;
  pullRequests?: string[];
  businessValue?: BusinessValue;
  effort?: Effort;
  revision: number;
  priority: Priority;
  urgency: Assessment["urgency"];
  quadrant: Assessment["quadrant"];
}

/** Search filters, as an agent gives them. */
export interface SearchInput {
  clientId?: string;
  states?: State[];
  text?: string;
  workstreamId?: string;
  claimedBy?: string;
  unclaimed?: boolean;
  blocked?: boolean;
  tag?: string;
  trackerKey?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  dueBy?: string;
  limit?: number;
}

/** Fields an agent may set when it adds or updates an item. */
export interface ItemFields {
  title?: string;
  summary?: string | null;
  state?: State;
  priority?: Priority;
  workstreamId?: string | null;
  requirementId?: string | null;
  scheduledFor?: string | null;
  due?: string | null;
  businessValue?: BusinessValue | null;
  effort?: Effort | null;
  rank?: string | null;
  kind?: "work" | "admin" | null;
  tracker?: Tracker | null;
  tags?: string[] | null;
  pullRequests?: string[] | null;
  blocked?: boolean | null;
  blockedOn?: { since: string; waitingFor: string; reason?: string } | null;
  detailsId?: string | null;
}

/** Thrown when an update changes nothing, so no revision is spent on it. */
export class NothingToChange extends Error {
  constructor(readonly id: string) {
    super(`no changes given for item ${id}`);
  }
}

const LIST_LIMIT = 25;
const MAX_LIMIT = 200;

/** Today's date in the context's time zone, as YYYY-MM-DD. */
export function today(ctx: Context): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ctx.now());
}

/** Thrown when `by` has nothing left once normalised. */
export class InvalidActor extends Error {
  constructor(readonly by: string) {
    super(
      `"${by}" is not usable as a name: give your session name, for example Builder`,
    );
  }
}

/**
 * The stored form of an agent's name: lower case, with anything other than
 * letters, digits and hyphens turned into hyphens, and an optional
 * `:qualifier` kept (`claude:atlas`). "Self-hosted runners" becomes
 * `self-hosted-runners`. The schema's identifier rule needs this form, and
 * normalising here means a session can pass its name as other sessions
 * address it.
 */
export function actor(by: string): string {
  const [head = "", ...rest] = by.trim().toLowerCase().split(":");
  const name = head.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const tail = rest
    .join(":")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) throw new InvalidActor(by);
  return tail ? `${name}:${tail}` : name;
}

function stamp(ctx: Context): string {
  return ctx
    .now()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

function summarise(item: DashboardItem, day: string): ItemSummary {
  const a = assess(item, day);
  return dropEmpty({
    id: item.id,
    clientId: item.clientId,
    title: item.title,
    state: item.state,
    workstreamId: item.workstreamId,
    scheduledFor: item.scheduledFor,
    due: item.due,
    doneOn: item.doneOn,
    kind: item.kind,
    blocked: item.blocked,
    claimedBy: item.claim?.by,
    trackerKey: item.tracker?.key,
    trackerUrl: item.tracker?.url,
    detailsId: item.detailsId,
    pullRequests: item.pullRequests?.length ? item.pullRequests : undefined,
    businessValue: item.businessValue,
    effort: item.effort,
    revision: item.revision,
    priority: a.priority,
    urgency: a.urgency,
    quadrant: a.quadrant,
  });
}

function dropEmpty<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null),
  ) as T;
}

/** Items matching the filters, most important first. Open items unless states say otherwise. */
export async function search(
  ctx: Context,
  input: SearchInput,
): Promise<{ today: string; count: number; items: ItemSummary[] }> {
  const day = today(ctx);
  if (input.clientId && !inScope(ctx, input.clientId)) {
    return { today: day, count: 0, items: [] };
  }
  const found = await searchItems(ctx.db, {
    clientId: input.clientId,
    clientIds: ctx.scope ? [...ctx.scope] : undefined,
    states: input.states?.length ? input.states : [...OPEN_STATES],
    text: input.text,
    workstreamId: input.workstreamId,
    claimedBy: input.unclaimed ? null : input.claimedBy,
    blocked: input.blocked,
    tag: input.tag,
    trackerKey: input.trackerKey,
    scheduledFrom: input.scheduledFrom,
    scheduledTo: input.scheduledTo,
    dueBy: input.dueBy,
  });
  found.sort((a, b) => compareItems(a, b, day));
  const limit = Math.min(input.limit ?? LIST_LIMIT, MAX_LIMIT);
  return {
    today: day,
    count: found.length,
    items: found.slice(0, limit).map((i) => summarise(i, day)),
  };
}

/** One item with its log, history and computed priority. */
export async function read(
  ctx: Context,
  id: string,
): Promise<DashboardItem & { assessment: Assessment }> {
  const item = await visible(ctx, id);
  return { ...item, assessment: assess(item, today(ctx)) };
}

/** Clients and their workstreams, so an agent knows the ids to use. */
export async function clients(ctx: Context): Promise<
  {
    id: string;
    name: string;
    classification: string;
    workstreams: { id: string; title: string }[];
  }[]
> {
  const rows = await ctx.db.select().from(tables.client);
  const streams = await ctx.db.select().from(tables.workstream);
  return rows
    .filter((c) => inScope(ctx, c.id))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      classification: c.classification,
      workstreams: streams
        .filter((w) => w.clientId === c.id)
        .sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
        )
        .map((w) => ({ id: w.id, title: w.title })),
    }));
}

/**
 * Add a new item for a client. It takes the client's classification and
 * boundary, gets a new lower-case ULID as its id, and starts at revision 1.
 */
export async function add(
  ctx: Context,
  by: string,
  clientId: string,
  fields: ItemFields & { title: string },
): Promise<DashboardItem> {
  const [owner] = await ctx.db
    .select()
    .from(tables.client)
    .where(eq(tables.client.id, clientId));
  if (!owner || !inScope(ctx, clientId))
    throw new Error(`no client ${clientId}`);
  const at = stamp(ctx);
  const item = apply(
    {
      id: ulid(ctx.now().getTime()),
      classification: owner.classification,
      boundary: owner.boundary,
      clientId,
      title: fields.title,
      state: "todo",
      priority: "normal",
      revision: 1,
      createdAt: at,
      updatedAt: at,
      history: [{ kind: "added", on: today(ctx), at, by: actor(by) }],
    },
    fields,
    today(ctx),
  );
  validateItem(item);
  await insertItem(ctx.db, item);
  return item;
}

/**
 * Fields that grade an item rather than work on it. The owner sets them while
 * planning, so an update that touches only these goes through another agent's
 * claim.
 */
const GRADING: ReadonlySet<keyof ItemFields> = new Set([
  "businessValue",
  "effort",
  "due",
]);

/**
 * Change an item's fields, at the revision the caller read. A field set to
 * null is cleared. Records a history entry for a state change, for a move to
 * another day, and for any other edit, and adds the note to the log when one
 * is given. Returns the new revision. Another agent's claim refuses the change
 * unless it is forced or touches only the grading fields.
 */
export function update(
  ctx: Context,
  by: string,
  id: string,
  revision: number,
  fields: ItemFields,
  options: { note?: string; force?: boolean } = {},
): Promise<number> {
  const keys = Object.keys(fields) as (keyof ItemFields)[];
  const grading = keys.length > 0 && keys.every((k) => GRADING.has(k));
  return change(
    ctx,
    by,
    id,
    revision,
    { ...options, force: options.force || grading },
    (item, day) => apply(item, fields, day),
  );
}

/**
 * Mark an item done today (or on `on`), clear its claim and its blocked
 * details, and log the note when one is given. Returns the new revision.
 */
export function complete(
  ctx: Context,
  by: string,
  id: string,
  revision: number,
  options: { note?: string; on?: string; force?: boolean } = {},
): Promise<number> {
  return change(ctx, by, id, revision, options, (item, day) => {
    const done = apply(item, { state: "done" }, day);
    if (options.on) done.doneOn = options.on;
    if (done.blocked) done.blocked = false;
    delete done.blockedOn;
    return done;
  });
}

async function change(
  ctx: Context,
  by: string,
  id: string,
  revision: number,
  options: { note?: string; force?: boolean },
  mutate: (item: DashboardItem, day: string) => DashboardItem,
): Promise<number> {
  const current = await visible(ctx, id);
  const who = actor(by);
  if (current.claim && actor(current.claim.by) !== who && !options.force) {
    throw new ClaimConflict(id, current.claim.by);
  }
  const day = today(ctx);
  const next = mutate(current, day);
  const changes = history(current, next, day, stamp(ctx), who);
  if (changes.length === 0 && !options.note) throw new NothingToChange(id);
  // Stored log and history entries are append-only records, checked when they
  // were written; validate the item's own fields and this change's entries.
  const fields: DashboardItem = { ...next };
  delete fields.log;
  delete fields.history;
  validateItem(changes.length ? { ...fields, history: changes } : fields);
  return ctx.db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const nextRevision = await updateItem(t, next, revision);
    if (changes.length) {
      await t.insert(tables.itemHistory).values(
        changes.map((h) => ({
          itemId: id,
          kind: h.kind,
          on: h.on,
          at: h.at ?? null,
          by: h.by ?? null,
          from: h.from ?? null,
          to: h.to ?? null,
        })),
      );
    }
    if (options.note) {
      await appendLog(t, id, {
        at: stamp(ctx),
        status: next.state,
        note: options.note,
        by: who,
      });
    }
    return nextRevision;
  });
}

/** Claim an item. Returns the new revision. */
export async function claim(
  ctx: Context,
  by: string,
  id: string,
): Promise<number> {
  await visible(ctx, id);
  return claimItem(ctx.db, id, actor(by), stamp(ctx));
}

/** Release a claim; `force` releases another agent's. Returns the new revision. */
export async function release(
  ctx: Context,
  by: string,
  id: string,
  force = false,
): Promise<number> {
  await visible(ctx, id);
  return releaseItem(ctx.db, id, actor(by), stamp(ctx), force);
}

/** Add a progress note. It does not change the item or its revision. */
export async function log(
  ctx: Context,
  by: string,
  id: string,
  status: State | "blocked",
  note: string,
): Promise<void> {
  await visible(ctx, id);
  await appendLog(ctx.db, id, { at: stamp(ctx), status, note, by: actor(by) });
}

/** The item with `fields` applied. Null clears a field; undefined leaves it. */
function apply(
  item: DashboardItem,
  fields: ItemFields,
  day: string,
): DashboardItem {
  const next: Record<string, unknown> = { ...item };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  if (next.blocked !== true) delete next.blockedOn;
  if (next.state === "done") {
    next.doneOn ??= day;
    delete next.claim;
  } else delete next.doneOn;
  return next as unknown as DashboardItem;
}

const TRACKED: readonly (keyof DashboardItem)[] = [
  "title",
  "summary",
  "priority",
  "workstreamId",
  "requirementId",
  "due",
  "businessValue",
  "effort",
  "rank",
  "kind",
  "tracker",
  "tags",
  "pullRequests",
  "blocked",
  "blockedOn",
  "detailsId",
];

function history(
  before: DashboardItem,
  after: DashboardItem,
  on: string,
  at: string,
  by: string,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  if (before.state !== after.state) {
    entries.push({
      kind: "state",
      on,
      at,
      by,
      from: before.state,
      to: after.state,
    });
  }
  if (before.scheduledFor !== after.scheduledFor) {
    entries.push({
      kind: "moved",
      on,
      at,
      by,
      from: before.scheduledFor ?? "unscheduled",
      to: after.scheduledFor ?? "unscheduled",
    });
  }
  const same = (k: keyof DashboardItem) =>
    JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null);
  if (!TRACKED.every(same)) entries.push({ kind: "edited", on, at, by });
  return entries;
}
