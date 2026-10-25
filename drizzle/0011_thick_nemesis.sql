CREATE TABLE "meeting_recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"uploaded_by_id" integer,
	"source" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "meeting_recordings_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "meeting_recordings" ADD CONSTRAINT "meeting_recordings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_recordings" ADD CONSTRAINT "meeting_recordings_uploaded_by_id_members_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_recordings_meeting_idx" ON "meeting_recordings" USING btree ("meeting_id");