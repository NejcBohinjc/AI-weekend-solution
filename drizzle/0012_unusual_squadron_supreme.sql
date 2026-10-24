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
ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_started_by_id_members_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_saved_note_id_meeting_notes_id_fk" FOREIGN KEY ("saved_note_id") REFERENCES "public"."meeting_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recording_segments_recording_index_uq" ON "recording_segments" USING btree ("recording_id","index");--> statement-breakpoint
CREATE INDEX "recordings_meeting_idx" ON "recordings" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "recordings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recording_segments" ENABLE ROW LEVEL SECURITY;
