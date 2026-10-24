// "local" storage mode only (development without a bucket): receives the browser's PUT of a recording
// and writes it to .data/recordings. With a bucket, the browser uploads straight to storage instead.
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { meetingRecordings } from "@/db/schema";
import { getCurrentMember } from "@/lib/auth";
import { MAX_RECORDING_BYTES } from "@/lib/meetings/constants";
import { storageMode, writeLocal } from "@/lib/storage";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (storageMode() !== "local") return NextResponse.json({ error: "not found" }, { status: 404 });
  const me = await getCurrentMember();
  if (!me) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const id = Number((await params).id);
  const [row] = Number.isInteger(id)
    ? await db
        .select()
        .from(meetingRecordings)
        .where(and(eq(meetingRecordings.id, id), eq(meetingRecordings.uploadedById, me.id), eq(meetingRecordings.status, "uploading")))
        .limit(1)
    : [];
  if (!row || !req.body) return NextResponse.json({ error: "no upload waiting" }, { status: 404 });
  try {
    await writeLocal(row.storageKey, req.body, Math.min(row.sizeBytes, MAX_RECORDING_BYTES));
  } catch {
    return NextResponse.json({ error: "the file is larger than announced" }, { status: 413 });
  }
  return new NextResponse(null, { status: 200 });
}
