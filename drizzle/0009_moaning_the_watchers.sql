CREATE TABLE "member_departments" (
	"member_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	CONSTRAINT "member_departments_member_id_department_id_pk" PRIMARY KEY("member_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT "members_department_id_departments_id_fk";
--> statement-breakpoint
ALTER TABLE "member_departments" ADD CONSTRAINT "member_departments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_departments" ADD CONSTRAINT "member_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_departments_department_idx" ON "member_departments" USING btree ("department_id");--> statement-breakpoint
-- Keep every member's current department.
INSERT INTO "member_departments" ("member_id", "department_id") SELECT "id", "department_id" FROM "members" WHERE "department_id" IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The Core department is for members of the Core tier, and all of them are in it.
DELETE FROM "member_departments" "md" USING "departments" "d", "members" "m" WHERE "md"."department_id" = "d"."id" AND "md"."member_id" = "m"."id" AND lower("d"."name") = 'core' AND "m"."tier" <> 'Core';--> statement-breakpoint
INSERT INTO "member_departments" ("member_id", "department_id") SELECT "m"."id", "d"."id" FROM "members" "m" JOIN "departments" "d" ON lower("d"."name") = 'core' WHERE "m"."tier" = 'Core' ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "department_id";
