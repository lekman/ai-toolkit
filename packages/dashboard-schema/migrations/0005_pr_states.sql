ALTER TYPE "public"."log_status" ADD VALUE 'approved' BEFORE 'done';--> statement-breakpoint
ALTER TYPE "public"."log_status" ADD VALUE 'merged' BEFORE 'done';--> statement-breakpoint
ALTER TYPE "public"."item_state" ADD VALUE 'approved' BEFORE 'done';--> statement-breakpoint
ALTER TYPE "public"."item_state" ADD VALUE 'merged' BEFORE 'done';