CREATE TABLE "sync_state" (
	"name" text PRIMARY KEY NOT NULL,
	"running_since" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_ok" boolean,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sheet_key" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sheet_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_members_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sheet_key_unique" UNIQUE("sheet_key");