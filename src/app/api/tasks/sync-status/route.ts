import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth";
import { tasksSyncStatus } from "@/lib/tasks/sync-status";

export const dynamic = "force-dynamic";

/** Polled by the tasks pages while a background sync runs. */
export async function GET() {
  const me = await getCurrentMember();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await tasksSyncStatus(me.isAdmin), { headers: { "Cache-Control": "no-store" } });
}
