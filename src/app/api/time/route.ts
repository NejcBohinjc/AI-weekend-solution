import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The server's clock, so the timer can correct for a phone whose clock is off. Never cached. */
export function GET() {
  return NextResponse.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
