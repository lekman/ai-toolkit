/**
 * Postgres storage for dashboard items, as Drizzle tables.
 *
 * Column names are the Atlas model's field names in snake case (clientId is
 * client_id, scheduledFor is scheduled_for), so an Atlas item imports by
 * copying fields. Progress notes and item history sit in their own append-only
 * tables, so a long-running item never grows a single field.
 *
 * The JSON Schema's cross-field rules are also enforced here, so a writer that
 * skips validation still cannot store a broken item: blocked details only on a
 * blocked item, doneOn only on a done one, and the length limits. Computed
 * priority, urgency and the today/tomorrow/future band have no columns.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const classificationEnum = pgEnum("classification", [
  "public",
  "internal",
  "client-confidential",
  "restricted",
]);

export const stateEnum = pgEnum("item_state", [
  "todo",
  "doing",
  "review",
  "done",
  "dropped",
]);

export const priorityEnum = pgEnum("priority", ["high", "normal", "low"]);

export const businessValueEnum = pgEnum("business_value", [
  "negative",
  "none",
  "low",
  "medium",
  "high",
  "veryHigh",
]);

export const effortEnum = pgEnum("effort", ["XS", "S", "M", "L", "XL"]);

export const kindEnum = pgEnum("item_kind", ["work", "admin"]);

export const historyKindEnum = pgEnum("history_kind", [
  "added",
  "moved",
  "state",
  "edited",
  "claimed",
  "released",
]);

export const logStatusEnum = pgEnum("log_status", [
  "todo",
  "doing",
  "review",
  "done",
  "dropped",
  "blocked",
]);

const stamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });
const day = (name: string) => date(name, { mode: "string" });
const identifier = (name: string) => varchar(name, { length: 128 });

/** Atlas Client: every governed record carries classification and boundary. */
export const client = pgTable("client", {
  id: identifier("id").primaryKey(),
  classification: classificationEnum("classification").notNull(),
  boundary: identifier("boundary").notNull(),
  name: varchar("name", { length: 140 }).notNull(),
  home: boolean("home"),
  order: doublePrecision("order"),
});

/**
 * Atlas Workstream: a grouping of items within a client. The unique pair
 * (id, client_id) is the target of the item's composite foreign key.
 */
export const workstream = pgTable(
  "workstream",
  {
    id: identifier("id").primaryKey(),
    classification: classificationEnum("classification").notNull(),
    boundary: identifier("boundary").notNull(),
    clientId: identifier("client_id")
      .notNull()
      .references(() => client.id),
    title: varchar("title", { length: 300 }).notNull(),
    summary: varchar("summary", { length: 2000 }),
    order: doublePrecision("order"),
  },
  (t) => [unique("workstream_id_client_id_key").on(t.id, t.clientId)],
);

export const dashboardItem = pgTable(
  "dashboard_item",
  {
    id: identifier("id").primaryKey(),
    classification: classificationEnum("classification").notNull(),
    boundary: identifier("boundary").notNull(),
    clientId: identifier("client_id")
      .notNull()
      .references(() => client.id),
    requirementId: identifier("requirement_id"),
    workstreamId: identifier("workstream_id"),
    title: varchar("title", { length: 300 }).notNull(),
    summary: varchar("summary", { length: 2000 }),
    state: stateEnum("state").notNull().default("todo"),
    priority: priorityEnum("priority").notNull().default("normal"),
    tracker: jsonb("tracker").$type<{
      system: string;
      key: string;
      url: string;
    }>(),
    effort: effortEnum("effort"),
    businessValue: businessValueEnum("business_value"),
    due: day("due"),
    scheduledFor: day("scheduled_for"),
    rank: varchar("rank", { length: 32 }),
    blocked: boolean("blocked"),
    blockedSince: day("blocked_since"),
    blockedWaitingFor: varchar("blocked_waiting_for", { length: 140 }),
    blockedReason: varchar("blocked_reason", { length: 280 }),
    doneOn: day("done_on"),
    kind: kindEnum("kind"),
    detailsId: identifier("details_id"),
    claimBy: varchar("claim_by", { length: 96 }),
    claimAt: stamp("claim_at"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    revision: integer("revision").notNull().default(1),
    createdAt: stamp("created_at").notNull().defaultNow(),
    updatedAt: stamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("dashboard_item_client_day_idx").on(t.clientId, t.scheduledFor),
    index("dashboard_item_state_idx").on(t.state),
    index("dashboard_item_due_idx").on(t.due),
    // An item's workstream must belong to the item's own client. With the
    // default MATCH SIMPLE, an item without a workstream is not checked.
    foreignKey({
      name: "dashboard_item_workstream_same_client_fk",
      columns: [t.workstreamId, t.clientId],
      foreignColumns: [workstream.id, workstream.clientId],
    }),
    check("dashboard_item_id_format", sql`${t.id} ~ '^[a-z0-9][a-z0-9-]*$'`),
    check(
      "dashboard_item_blocked_details",
      sql`${t.blocked} IS TRUE OR (${t.blockedSince} IS NULL AND ${t.blockedWaitingFor} IS NULL AND ${t.blockedReason} IS NULL)`,
    ),
    check(
      "dashboard_item_blocked_pair",
      sql`(${t.blockedSince} IS NULL) = (${t.blockedWaitingFor} IS NULL)`,
    ),
    check(
      "dashboard_item_done_on",
      sql`${t.state} = 'done' OR ${t.doneOn} IS NULL`,
    ),
    check(
      "dashboard_item_claim_pair",
      sql`(${t.claimBy} IS NULL) = (${t.claimAt} IS NULL)`,
    ),
    check("dashboard_item_revision_positive", sql`${t.revision} >= 1`),
  ],
);

/** Progress notes: a time and a short status. Append only. */
export const itemLog = pgTable(
  "item_log",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    itemId: identifier("item_id")
      .notNull()
      .references(() => dashboardItem.id, { onDelete: "cascade" }),
    at: stamp("at").notNull(),
    status: logStatusEnum("status").notNull(),
    note: varchar("note", { length: 160 }).notNull(),
    by: varchar("by", { length: 96 }),
  },
  (t) => [index("item_log_item_at_idx").on(t.itemId, t.at)],
);

/** What happened to the item: Atlas's added and moved, plus the additions. Append only. */
export const itemHistory = pgTable(
  "item_history",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    itemId: identifier("item_id")
      .notNull()
      .references(() => dashboardItem.id, { onDelete: "cascade" }),
    kind: historyKindEnum("kind").notNull(),
    on: day("on").notNull(),
    at: stamp("at"),
    by: varchar("by", { length: 96 }),
    from: varchar("from", { length: 80 }),
    to: varchar("to", { length: 80 }),
  },
  (t) => [index("item_history_item_on_idx").on(t.itemId, t.on)],
);

/**
 * A message from one agent session to another, carried by the task database
 * because it is the one service every machine reaches, a tunnelled laptop
 * included. The body is about one client and governed like that client's
 * items. Messages are never edited; a delivery stamps them once.
 */
export const message = pgTable(
  "message",
  {
    id: identifier("id").primaryKey(),
    classification: classificationEnum("classification").notNull(),
    boundary: identifier("boundary").notNull(),
    clientId: identifier("client_id")
      .notNull()
      .references(() => client.id),
    from: varchar("from", { length: 96 }).notNull(),
    to: varchar("to", { length: 96 }).notNull(),
    body: varchar("body", { length: 4000 }).notNull(),
    createdAt: stamp("created_at").notNull().defaultNow(),
    deliveredAt: stamp("delivered_at"),
    deliveredBy: varchar("delivered_by", { length: 96 }),
  },
  (t) => [
    index("message_to_created_idx").on(t.to, t.createdAt),
    index("message_undelivered_idx")
      .on(t.createdAt)
      .where(sql`${t.deliveredAt} IS NULL`),
    check("message_id_format", sql`${t.id} ~ '^[a-z0-9][a-z0-9-]*$'`),
    check(
      "message_delivered_pair",
      sql`(${t.deliveredAt} IS NULL) = (${t.deliveredBy} IS NULL)`,
    ),
  ],
);
