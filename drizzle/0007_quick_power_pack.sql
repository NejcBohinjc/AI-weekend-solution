CREATE TABLE "ai_task_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"item_key" text NOT NULL,
	"task_id" integer,
	"run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_task_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"note_id" integer,
	"notes_hash" text NOT NULL,
	"triggered_by_id" integer,
	"model" text,
	"called_api" boolean NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"discarded" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"author_id" integer,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"file_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by_ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_meeting_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_quote" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "triggered_by_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ai_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_task_items" ADD CONSTRAINT "ai_task_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_items" ADD CONSTRAINT "ai_task_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_items" ADD CONSTRAINT "ai_task_items_run_id_ai_task_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_task_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_runs" ADD CONSTRAINT "ai_task_runs_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_runs" ADD CONSTRAINT "ai_task_runs_note_id_meeting_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."meeting_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_runs" ADD CONSTRAINT "ai_task_runs_triggered_by_id_members_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_task_items_key_idx" ON "ai_task_items" USING btree ("meeting_id","item_key");--> statement-breakpoint
CREATE INDEX "ai_task_runs_meeting_idx" ON "ai_task_runs" USING btree ("meeting_id","notes_hash");--> statement-breakpoint
CREATE INDEX "ai_task_runs_member_idx" ON "ai_task_runs" USING btree ("triggered_by_id","created_at");--> statement-breakpoint
CREATE INDEX "meeting_notes_meeting_idx" ON "meeting_notes" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_meeting_id_meetings_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_triggered_by_id_members_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Supabase: no direct access through its public API to these tables (the app connects as the owner, which RLS does not restrict).
ALTER TABLE "meeting_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_task_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_task_items" ENABLE ROW LEVEL SECURITY;
