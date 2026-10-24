CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_department_idx" ON "tasks" USING btree ("department_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_one_owner" CHECK ("tasks"."assignee_id" is null or "tasks"."department_id" is null);--> statement-breakpoint
-- The departments in use when this was added; admins add more on /admin/departments.
INSERT INTO "departments" ("name") VALUES ('Core'), ('Voice'), ('Tech') ON CONFLICT ("name") DO NOTHING;
