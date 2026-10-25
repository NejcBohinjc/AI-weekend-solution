CREATE TABLE "task_reminders" (
	"task_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"due_date" date NOT NULL,
	"days_before" integer NOT NULL,
	"email_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reminders_task_id_member_id_due_date_days_before_pk" PRIMARY KEY("task_id","member_id","due_date","days_before")
);
--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "task_email_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_settings" ADD COLUMN "task_days_before" integer[] DEFAULT '{1}' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_email_id_email_log_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_log"("id") ON DELETE set null ON UPDATE no action;