ALTER TABLE "meeting_reminders" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD COLUMN "claimed_at" timestamp with time zone DEFAULT now() NOT NULL;