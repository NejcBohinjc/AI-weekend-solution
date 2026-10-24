ALTER TABLE "tasks" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "status_before_done" text;--> statement-breakpoint
-- Tasks already done: completed when they were last marked Done in their history (null if unknown).
UPDATE "tasks" t SET "completed_at" = (
  SELECT max(e."created_at") FROM "task_events" e WHERE e."task_id" = t."id" AND e."field" = 'status' AND e."new_value" = 'Done'
) WHERE t."status" = 'done';
