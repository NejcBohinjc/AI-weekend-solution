CREATE TABLE "ai_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer,
	"meeting_id" integer,
	"model" text,
	"ok" boolean NOT NULL,
	"found" boolean,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "general_task_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"meeting_id" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_task_id" integer,
	"picked_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recording_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"recording_id" integer NOT NULL,
	"index" integer NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" text DEFAULT 'audio/mpeg' NOT NULL,
	"duration_ms" integer NOT NULL,
	"bytes" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transcript" text,
	"transcript_status" text,
	"transcript_error" text,
	"transcript_started_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"started_by_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'recording' NOT NULL,
	"error" text,
	"source" text DEFAULT 'recorded' NOT NULL,
	"file_name" text,
	"languages" text,
	"transcript" text,
	"transcribe_model" text,
	"transcribed_seconds" integer DEFAULT 0 NOT NULL,
	"transcribe_lease_until" timestamp with time zone,
	"saved_note_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "late_notice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "late_decision" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "late_decided_by_id" integer;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "late_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status_before_done" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "ai_questions" ADD CONSTRAINT "ai_questions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_questions" ADD CONSTRAINT "ai_questions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_task_requests" ADD CONSTRAINT "general_task_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_task_requests" ADD CONSTRAINT "general_task_requests_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_task_requests" ADD CONSTRAINT "general_task_requests_picked_task_id_tasks_id_fk" FOREIGN KEY ("picked_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_started_by_id_members_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_saved_note_id_meeting_notes_id_fk" FOREIGN KEY ("saved_note_id") REFERENCES "public"."meeting_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_questions_member_idx" ON "ai_questions" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "general_task_requests_member_meeting_idx" ON "general_task_requests" USING btree ("member_id","meeting_id");--> statement-breakpoint
CREATE INDEX "notifications_member_idx" ON "notifications" USING btree ("member_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_member_created_idx" ON "notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recording_segments_recording_index_uq" ON "recording_segments" USING btree ("recording_id","index");--> statement-breakpoint
CREATE INDEX "recordings_meeting_idx" ON "recordings" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_late_decided_by_id_members_id_fk" FOREIGN KEY ("late_decided_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_task_runs_note_idx" ON "ai_task_runs" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "attendance_late_pending_idx" ON "attendance" USING btree ("meeting_id") WHERE "attendance"."state" = 'excused' and "attendance"."late_notice" and "attendance"."late_decision" is null;--> statement-breakpoint
CREATE INDEX "meeting_imports_source_idx" ON "meeting_imports" USING btree ("source","id");--> statement-breakpoint
CREATE INDEX "task_events_activity_idx" ON "task_events" USING btree ("created_at") WHERE "task_events"."actor_id" is not null and "task_events"."source" = 'app';--> statement-breakpoint
CREATE INDEX "tasks_open_assignee_idx" ON "tasks" USING btree ("assignee_id","due_date") WHERE "tasks"."deleted_at" is null and "tasks"."kind" = 'project' and "tasks"."status" <> 'done';--> statement-breakpoint
CREATE INDEX "tasks_created_idx" ON "tasks" USING btree ("created_at") WHERE "tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_completed_idx" ON "tasks" USING btree ("completed_at") WHERE "tasks"."completed_at" is not null;--> statement-breakpoint
CREATE INDEX "tasks_source_meeting_idx" ON "tasks" USING btree ("source_meeting_id") WHERE "tasks"."source_meeting_id" is not null;--> statement-breakpoint
CREATE INDEX "time_entries_started_idx" ON "time_entries" USING btree ("started_at") WHERE "time_entries"."deleted_at" is null;--> statement-breakpoint
-- Tasks already done: completed when they were last marked Done in their history (null if unknown).
UPDATE "tasks" t SET "completed_at" = (
  SELECT max(e."created_at") FROM "task_events" e WHERE e."task_id" = t."id" AND e."field" = 'status' AND e."new_value" = 'Done'
) WHERE t."status" = 'done';--> statement-breakpoint
-- Supabase: no direct access to new tables through its public API (the app connects as the owner, which
-- RLS does not restrict). Also for the tables of migrations 0008-0012, which were created without it.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "general_task_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recordings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recording_segments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meeting_recordings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_reminders" ENABLE ROW LEVEL SECURITY;
