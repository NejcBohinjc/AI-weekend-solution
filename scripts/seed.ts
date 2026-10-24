// Loads sandbox data from data/ into the database. Safe to re-run (upserts by email).
import "dotenv/config";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { attendance, meetings, members, timeEntries, TIERS, type Tier } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { PASSWORD_MIN_LENGTH } from "../src/lib/auth/password-rules";
import { addDays, ljubljanaParts, ljubljanaToUtc } from "../src/lib/hours/time";
import { ATTENDANCE_STATES, type AttendanceState } from "../src/lib/meetings/constants";
import { parseIcs } from "../src/lib/meetings/ics";
import { importMeetings, importWindow } from "../src/lib/meetings/import";

async function readSheet(path: string): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const values = (row.values as unknown[]).slice(1);
    rows.push(Object.fromEntries(header.map((h, j) => [h, values[j]])));
  });
  return rows;
}

// DEMO_MODE=true: every seeded member gets DEMO_PASSWORD. Otherwise no passwords are set
// (and existing ones are left alone); members get setup links from an admin instead.
async function demoPasswordHash(): Promise<string | null> {
  if (process.env.DEMO_MODE !== "true") return null;
  const pw = process.env.DEMO_PASSWORD ?? "";
  if (pw.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`DEMO_MODE=true needs DEMO_PASSWORD with at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  return hashPassword(pw);
}

async function seedMembers() {
  const rows = await readSheet("data/roster.xlsx");
  const passwordHash = await demoPasswordHash();
  const values = rows.map((r) => {
    const tier = String(r.tier) as Tier;
    if (!TIERS.includes(tier)) throw new Error(`Unknown tier "${tier}" for ${r.email}`);
    return {
      name: String(r.name),
      email: String(r.email).toLowerCase(),
      tier,
      weeklyHours: Number(r.weekly_hours),
      isAdmin: String(r.admin).toLowerCase() === "yes",
      series: String(r.series ?? "").split(";").map((s) => s.trim()).filter(Boolean),
      ...(passwordHash && { passwordHash }),
    };
  });
  await db
    .insert(members)
    .values(values)
    .onConflictDoUpdate({
      target: members.email,
      set: {
        name: sql`excluded.name`,
        tier: sql`excluded.tier`,
        weeklyHours: sql`excluded.weekly_hours`,
        isAdmin: sql`excluded.is_admin`,
        series: sql`excluded.series`,
        ...(passwordHash && { passwordHash: sql`excluded.password_hash` }),
      },
    });
  console.log(`members: ${values.length} (${values.filter((v) => v.isAdmin).length} admins)`);
  console.log(passwordHash ? "passwords: all set to DEMO_PASSWORD (demo mode)" : "passwords: none set (not demo mode)");
}

// hours.xlsx has weekly totals only. Each total becomes five entries, Monday to Friday, so the
// history looks like real days. They are marked "seed" and never written to the Google Sheet.
// Re-running replaces the seed entries and leaves everything members logged themselves alone.
const SEED_DAYS = 5;

async function seedHours() {
  const rows = await readSheet("data/hours.xlsx");
  const ids = new Map((await db.select({ id: members.id, email: members.email }).from(members)).map((m) => [m.email, m.id]));
  const values: (typeof timeEntries.$inferInsert)[] = [];
  for (const r of rows) {
    const memberId = ids.get(String(r.email).toLowerCase());
    if (!memberId) throw new Error(`hours.xlsx: no member with email ${r.email}`);
    const weekStart = (r.week_start as Date).toISOString().slice(0, 10);
    const totalMinutes = Math.round(Number(r.hours) * 60);
    for (let day = 0; day < SEED_DAYS; day++) {
      const minutes = Math.floor(totalMinutes / SEED_DAYS) + (day < totalMinutes % SEED_DAYS ? 1 : 0);
      if (!minutes) continue;
      // Start at 08:00, or earlier for long days so the entry ends before midnight.
      const startMinute = Math.min(8 * 60, 23 * 60 + 30 - minutes);
      const time = `${String(Math.floor(startMinute / 60)).padStart(2, "0")}:${String(startMinute % 60).padStart(2, "0")}`;
      const startedAt = ljubljanaToUtc(addDays(weekStart, day), time);
      values.push({ memberId, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000), source: "seed", sheetStatus: "skip" });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(timeEntries).where(eq(timeEntries.source, "seed"));
    await tx.insert(timeEntries).values(values);
  });
  console.log(`hours: ${rows.length} weekly totals -> ${values.length} entries`);
}

// Meetings come from data/meetings.ics, the same way an admin imports a calendar export.
async function seedMeetings() {
  const { meetings: parsed, skipped } = parseIcs(readFileSync("data/meetings.ics", "utf8"), {
    from: new Date("2000-01-01T00:00:00Z"),
    to: importWindow().to,
  });
  const report = await importMeetings(parsed, { source: "seed", actorId: null, skipped });
  console.log(`meetings: ${report.meetings} (${report.invites} invitations, ${report.unknownEmails.length} unknown emails)`);
}

// attendance.xlsx has one row per member per past meeting; a meeting is found by series and date.
// Re-running updates seeded rows only, never what members or admins recorded.
async function seedAttendance() {
  const rows = await readSheet("data/attendance.xlsx");
  const ids = new Map((await db.select({ id: members.id, email: members.email }).from(members)).map((m) => [m.email, m.id]));
  const byKey = new Map(
    (await db.select({ id: meetings.id, series: meetings.series, startsAt: meetings.startsAt }).from(meetings)).map((m) => [
      `${m.series}|${ljubljanaParts(m.startsAt).date}`,
      m.id,
    ]),
  );
  const values = rows.map((r) => {
    const key = `${r.series}|${(r.date as Date).toISOString().slice(0, 10)}`;
    const meetingId = byKey.get(key);
    const memberId = ids.get(String(r.email).toLowerCase());
    const state = String(r.state) as AttendanceState;
    if (!meetingId) throw new Error(`attendance.xlsx: no meeting for ${key}`);
    if (!memberId) throw new Error(`attendance.xlsx: no member with email ${r.email}`);
    if (!ATTENDANCE_STATES.includes(state)) throw new Error(`attendance.xlsx: unknown state "${state}"`);
    return { meetingId, memberId, state, source: "seed" as const };
  });
  await db
    .insert(attendance)
    .values(values)
    .onConflictDoUpdate({
      target: [attendance.meetingId, attendance.memberId],
      set: { state: sql`excluded.state`, updatedAt: new Date() },
      setWhere: sql`${attendance.source} = 'seed'`,
    });
  console.log(`attendance: ${values.length} records`);
}

async function main() {
  await seedMembers();
  await seedHours();
  await seedMeetings();
  await seedAttendance();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
