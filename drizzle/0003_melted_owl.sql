CREATE TABLE "time_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" text NOT NULL,
	"edited_by_id" integer,
	"deleted_at" timestamp with time zone,
	"sheet_status" text DEFAULT 'pending' NOT NULL,
	"sheet_error" text,
	"sheet_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_end_after_start" CHECK ("time_entries"."ended_at" is null or "time_entries"."ended_at" > "time_entries"."started_at")
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_edited_by_id_members_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_running_idx" ON "time_entries" USING btree ("member_id") WHERE "time_entries"."ended_at" is null and "time_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "time_entries_member_idx" ON "time_entries" USING btree ("member_id","started_at");--> statement-breakpoint
CREATE INDEX "time_entries_sheet_idx" ON "time_entries" USING btree ("sheet_status");