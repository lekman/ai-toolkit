ALTER TABLE "dashboard_item" DROP CONSTRAINT "dashboard_item_workstream_id_workstream_id_fk";
--> statement-breakpoint
ALTER TABLE "workstream" ADD CONSTRAINT "workstream_id_client_id_key" UNIQUE("id","client_id");--> statement-breakpoint
ALTER TABLE "dashboard_item" ADD CONSTRAINT "dashboard_item_workstream_same_client_fk" FOREIGN KEY ("workstream_id","client_id") REFERENCES "public"."workstream"("id","client_id") ON DELETE no action ON UPDATE no action;
