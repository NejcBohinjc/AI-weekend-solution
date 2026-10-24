import { asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { members, tasks } from "@/db/schema";

export function activeMembers() {
  return db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)).orderBy(asc(members.name));
}

export async function taskTypes(): Promise<string[]> {
  const rows = await db.selectDistinct({ type: tasks.type }).from(tasks).where(isNotNull(tasks.type)).orderBy(asc(tasks.type));
  return rows.map((r) => r.type!);
}
