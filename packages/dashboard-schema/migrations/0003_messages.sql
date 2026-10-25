CREATE TABLE "message" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"classification" "classification" NOT NULL,
	"boundary" varchar(128) NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"from" varchar(96) NOT NULL,
	"to" varchar(96) NOT NULL,
	"body" varchar(4000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivered_by" varchar(96),
	CONSTRAINT "message_id_format" CHECK ("message"."id" ~ '^[a-z0-9][a-z0-9-]*$'),
	CONSTRAINT "message_delivered_pair" CHECK (("message"."delivered_at" IS NULL) = ("message"."delivered_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_to_created_idx" ON "message" USING btree ("to","created_at");--> statement-breakpoint
CREATE INDEX "message_undelivered_idx" ON "message" USING btree ("created_at") WHERE "message"."delivered_at" IS NULL;