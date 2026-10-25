CREATE TABLE "slack_announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"channel_id" text,
	"post_at" timestamp with time zone NOT NULL,
	"content_hash" text,
	"scheduled_message_id" text,
	"message_ts" text,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_channels" (
	"series" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_members" (
	"member_id" integer PRIMARY KEY NOT NULL,
	"slack_user_id" text,
	"manual" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_announcements" ADD CONSTRAINT "slack_announcements_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_members" ADD CONSTRAINT "slack_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_announcements_meeting_kind_uq" ON "slack_announcements" USING btree ("meeting_id","kind");