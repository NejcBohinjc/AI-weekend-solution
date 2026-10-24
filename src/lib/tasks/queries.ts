import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";

export function activeMembers() {
  return db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)).orderBy(asc(members.name));
}
