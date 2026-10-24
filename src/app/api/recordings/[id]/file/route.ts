// "local" storage mode only: plays a recording from .data/recordings for the meeting's invitees and
// admins, with byte ranges so players can seek. With a bucket, players get a signed storage URL instead.
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentMember } from "@/lib/auth";
import { playableRecording } from "@/lib/meetings/recording-access";
import { parseRange } from "@/lib/meetings/recordings";
import { readLocal, storageMode, storedSize } from "@/lib/storage";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (storageMode() !== "local") return NextResponse.json({ error: "not found" }, { status: 404 });
  const me = await getCurrentMember();
  if (!me) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const id = Number((await params).id);
  const row = Number.isInteger(id) ? await playableRecording(me, id) : null;
  const size = row ? await storedSize(row.storageKey) : null;
  if (!row || size === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  const headers = { "Content-Type": row.contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  if (!range) return new NextResponse(readLocal(row.storageKey), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  return new NextResponse(readLocal(row.storageKey, range), {
    status: 206,
    headers: { ...headers, "Content-Length": String(range.end - range.start + 1), "Content-Range": `bytes ${range.start}-${range.end}/${size}` },
  });
}
