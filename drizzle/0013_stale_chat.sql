CREATE INDEX "ai_task_runs_note_idx" ON "ai_task_runs" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "attendance_late_pending_idx" ON "attendance" USING btree ("meeting_id") WHERE "attendance"."state" = 'excused' and "attendance"."late_notice" and "attendance"."late_decision" is null;--> statement-breakpoint
CREATE INDEX "meeting_imports_source_idx" ON "meeting_imports" USING btree ("source","id");--> statement-breakpoint
CREATE INDEX "notifications_member_created_idx" ON "notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "task_events_activity_idx" ON "task_events" USING btree ("created_at") WHERE "task_events"."actor_id" is not null and "task_events"."source" = 'app';--> statement-breakpoint
CREATE INDEX "tasks_open_assignee_idx" ON "tasks" USING btree ("assignee_id","due_date") WHERE "tasks"."deleted_at" is null and "tasks"."kind" = 'project' and "tasks"."status" <> 'done';--> statement-breakpoint
CREATE INDEX "tasks_created_idx" ON "tasks" USING btree ("created_at") WHERE "tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_completed_idx" ON "tasks" USING btree ("completed_at") WHERE "tasks"."completed_at" is not null;--> statement-breakpoint
CREATE INDEX "tasks_source_meeting_idx" ON "tasks" USING btree ("source_meeting_id") WHERE "tasks"."source_meeting_id" is not null;--> statement-breakpoint
CREATE INDEX "time_entries_started_idx" ON "time_entries" USING btree ("started_at") WHERE "time_entries"."deleted_at" is null;