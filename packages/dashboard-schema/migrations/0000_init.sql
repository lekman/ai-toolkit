CREATE TYPE "public"."business_value" AS ENUM('negative', 'none', 'low', 'medium', 'high', 'veryHigh');--> statement-breakpoint
CREATE TYPE "public"."classification" AS ENUM('public', 'internal', 'client-confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."effort" AS ENUM('XS', 'S', 'M', 'L', 'XL');--> statement-breakpoint
CREATE TYPE "public"."history_kind" AS ENUM('added', 'moved', 'state', 'edited', 'claimed', 'released');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('work', 'admin');--> statement-breakpoint
CREATE TYPE "public"."log_status" AS ENUM('todo', 'doing', 'review', 'done', 'dropped', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."item_state" AS ENUM('todo', 'doing', 'review', 'done', 'dropped');--> statement-breakpoint
CREATE TABLE "client" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"classification" "classification" NOT NULL,
	"boundary" varchar(128) NOT NULL,
	"name" varchar(140) NOT NULL,
	"home" boolean,
	"order" double precision
);
--> statement-breakpoint
CREATE TABLE "dashboard_item" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"classification" "classification" NOT NULL,
	"boundary" varchar(128) NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"requirement_id" varchar(128),
	"workstream_id" varchar(128),
	"title" varchar(300) NOT NULL,
	"summary" varchar(2000),
	"state" "item_state" DEFAULT 'todo' NOT NULL,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"tracker" jsonb,
	"effort" "effort",
	"business_value" "business_value",
	"due" date,
	"scheduled_for" date,
	"rank" varchar(32),
	"blocked" boolean,
	"blocked_since" date,
	"blocked_waiting_for" varchar(140),
	"blocked_reason" varchar(280),
	"done_on" date,
	"kind" "item_kind",
	"details_id" varchar(128),
	"claim_by" varchar(96),
	"claim_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_item_id_format" CHECK ("dashboard_item"."id" ~ '^[a-z0-9][a-z0-9-]*$'),
	CONSTRAINT "dashboard_item_blocked_details" CHECK ("dashboard_item"."blocked" IS TRUE OR ("dashboard_item"."blocked_since" IS NULL AND "dashboard_item"."blocked_waiting_for" IS NULL AND "dashboard_item"."blocked_reason" IS NULL)),
	CONSTRAINT "dashboard_item_blocked_pair" CHECK (("dashboard_item"."blocked_since" IS NULL) = ("dashboard_item"."blocked_waiting_for" IS NULL)),
	CONSTRAINT "dashboard_item_done_on" CHECK ("dashboard_item"."state" = 'done' OR "dashboard_item"."done_on" IS NULL),
	CONSTRAINT "dashboard_item_claim_pair" CHECK (("dashboard_item"."claim_by" IS NULL) = ("dashboard_item"."claim_at" IS NULL)),
	CONSTRAINT "dashboard_item_revision_positive" CHECK ("dashboard_item"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "item_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "item_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" varchar(128) NOT NULL,
	"kind" "history_kind" NOT NULL,
	"on" date NOT NULL,
	"at" timestamp with time zone,
	"by" varchar(96),
	"from" varchar(80),
	"to" varchar(80)
);
--> statement-breakpoint
CREATE TABLE "item_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "item_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" varchar(128) NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"status" "log_status" NOT NULL,
	"note" varchar(160) NOT NULL,
	"by" varchar(96)
);
--> statement-breakpoint
CREATE TABLE "workstream" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"classification" "classification" NOT NULL,
	"boundary" varchar(128) NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"title" varchar(300) NOT NULL,
	"summary" varchar(2000),
	"order" double precision
);
--> statement-breakpoint
ALTER TABLE "dashboard_item" ADD CONSTRAINT "dashboard_item_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_item" ADD CONSTRAINT "dashboard_item_workstream_id_workstream_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstream"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_history" ADD CONSTRAINT "item_history_item_id_dashboard_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."dashboard_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_log" ADD CONSTRAINT "item_log_item_id_dashboard_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."dashboard_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream" ADD CONSTRAINT "workstream_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dashboard_item_client_day_idx" ON "dashboard_item" USING btree ("client_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "dashboard_item_state_idx" ON "dashboard_item" USING btree ("state");--> statement-breakpoint
CREATE INDEX "dashboard_item_due_idx" ON "dashboard_item" USING btree ("due");--> statement-breakpoint
CREATE INDEX "item_history_item_on_idx" ON "item_history" USING btree ("item_id","on");--> statement-breakpoint
CREATE INDEX "item_log_item_at_idx" ON "item_log" USING btree ("item_id","at");