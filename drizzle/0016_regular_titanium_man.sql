ALTER TABLE "meeting_notes" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD COLUMN "summary_model" text;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD COLUMN "summary_at" timestamp with time zone;