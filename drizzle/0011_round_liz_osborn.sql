CREATE TABLE "ai_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer,
	"meeting_id" integer,
	"model" text,
	"ok" boolean NOT NULL,
	"found" boolean,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_questions" ADD CONSTRAINT "ai_questions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_questions" ADD CONSTRAINT "ai_questions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_questions_member_idx" ON "ai_questions" USING btree ("member_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_questions" ENABLE ROW LEVEL SECURITY;
