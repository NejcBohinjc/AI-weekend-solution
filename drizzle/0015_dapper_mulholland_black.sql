ALTER TABLE "meeting_reminders" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Supabase: no direct access to the Slack tables (added in 0014 without it) through its public API; the app
-- connects as the owner, which RLS does not restrict.
ALTER TABLE "slack_announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slack_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slack_members" ENABLE ROW LEVEL SECURITY;
