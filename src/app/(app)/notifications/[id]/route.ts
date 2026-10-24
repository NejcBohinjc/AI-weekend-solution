import { NextResponse, type NextRequest } from "next/server";
import { getCurrentMember } from "@/lib/auth";
import { readNotification } from "@/lib/notifications";

/** Opens a notification: marks it read (only the member's own) and goes to its link inside the app. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentMember();
  if (!me) return NextResponse.redirect(new URL("/login", req.url));
  const id = Number((await params).id);
  const row = Number.isInteger(id) ? await readNotification(me.id, id) : null;
  // Only links within the app; anything else falls back to the list.
  const target = row?.link && row.link.startsWith("/") && !row.link.startsWith("//") ? row.link : "/notifications";
  return NextResponse.redirect(new URL(target, req.url));
}
