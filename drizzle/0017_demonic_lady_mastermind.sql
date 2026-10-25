CREATE TABLE "slack_withdrawals" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"scheduled_message_id" text,
	"message_ts" text,
	"post_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
