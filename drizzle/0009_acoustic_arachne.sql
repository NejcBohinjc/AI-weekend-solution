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
ALTER TABLE "attendance" ADD COLUMN "late_notice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "late_decision" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "late_decided_by_id" integer;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "late_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "kind" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "general_task_requests" ADD CONSTRAINT "general_task_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_task_requests" ADD CONSTRAINT "general_task_requests_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_task_requests" ADD CONSTRAINT "general_task_requests_picked_task_id_tasks_id_fk" FOREIGN KEY ("picked_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "general_task_requests_member_meeting_idx" ON "general_task_requests" USING btree ("member_id","meeting_id");--> statement-breakpoint
CREATE INDEX "notifications_member_idx" ON "notifications" USING btree ("member_id","read_at");--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_late_decided_by_id_members_id_fk" FOREIGN KEY ("late_decided_by_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Supabase: no direct access through its public API (the app connects as the owner, which RLS does not restrict).
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "general_task_requests" ENABLE ROW LEVEL SECURITY;
